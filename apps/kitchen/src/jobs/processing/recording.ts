import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import * as path from 'node:path';

import { source, stripIndent } from 'common-tags';
import { execaCommand } from 'execa';
import he from 'he';
import zip from 'just-zip-it';

import { fileNameFromUser, FormatToCommand, getEncodeOptions, runParallelFunction } from '../../util/index.js';
import {
  copyFFmpegLicense,
  DEF_TIMEOUT,
  encodeMix,
  encodeMixTrack,
  encodeTrack,
  getFileDuration,
  getNotes,
  getStreamTypes,
  recordingWrite,
  reEncodeTrack
} from '../../util/process.js';
import { procOpts } from '../../util/processOptions.js';
import { getInfoText, getRecordingInfo } from '../../util/recording.js';
import { Job } from '../job.js';

// TODO ogg handling (??)
// TODO mkv handling (??)

export async function processRecordingJob(job: Job) {
  const { id, recFileBase, tmpDir } = job;
  const cancelSignal = job.abortController.signal;

  const { info, users } = await getRecordingInfo(recFileBase);
  const streamTypes = await getStreamTypes({ recFileBase, cancelSignal });
  const notes = await getNotes({ recFileBase, cancelSignal });
  const trackFiles: string[] = [];
  const pOpts = procOpts();
  const projectMode = job.options?.container === 'aupzip' || job.options?.container === 'sesxzip';

  async function createTrack(i: number) {
    const user = users[i];
    const track = i + 1;
    const fileName = fileNameFromUser(track, user);

    let audioDir = tmpDir;
    if (job.options?.container === 'mix') {
      const audioWritePath = path.join(audioDir, `${fileName}.ogg`);
      trackFiles.push(audioWritePath);
      job.setState({
        type: job.state.type,
        tracks: {
          ...(job.state.tracks || {}),
          [track]: { progress: 0, processing: true }
        }
      });
      job.push.flush();
      await encodeMixTrack({ recFileBase, cancelSignal, track, audioWritePath });
      job.setState({
        type: job.state.type,
        tracks: {
          ...(job.state.tracks || {}),
          [track]: { progress: 100 }
        }
      });
    } else {
      job.setState({
        type: job.state.type,
        tracks: {
          ...(job.state.tracks || {}),
          [track]: { progress: 0, processing: true }
        }
      });
      if (projectMode) audioDir = path.join(tmpDir, `${job.recordingId}_data`);
      const [audioWritePath, encodeCommand] = getEncodeOptions(audioDir, fileName, job.options?.format);
      trackFiles.push(audioWritePath);
      const success = await encodeTrack({
        recFileBase,
        cancelSignal,
        track,
        job,
        codec: streamTypes[i],
        encodeCommand,
        audioWritePath,
        dynaudnorm: !!job.options?.dynaudnorm
      });

      // Reprocess unsuccessful tracks to avoid annoyance with project programs
      if (projectMode && !success) await reEncodeTrack({ cancelSignal, audioWritePath });

      job.setState({
        type: 'encoding',
        tracks: {
          ...(job.state.tracks || {}),
          [track]: { progress: 100, warn: !success }
        }
      });

      if (!success) job.outputData.usersWarned = [...(job.outputData.usersWarned || []), track];
    }
  }

  job.setState(job.options?.container === 'mix' ? { type: 'processing', tracks: {} } : { type: 'encoding', tracks: {} });

  // Self-extractor prep
  switch (job.options?.format) {
    case 'wavsfx': {
      const runMeBat = createWriteStream(path.join(tmpDir, 'RunMe.bat'));
      await copyFFmpegLicense(runMeBat, '@REM   $1\r');
      runMeBat.close();
      await fs.copyFile('./cook/ffmpeg-wav.exe', path.join(tmpDir, 'ffmpeg.exe'));
      break;
    }
    case 'powersfx': {
      await fs.copyFile('./cook/ffmpeg-fat.exe', path.join(tmpDir, 'ffmpeg.exe'));
      break;
    }
    case 'wavsfxm':
    case 'wavsfxu': {
      let suffix = 'sh';

      if (job.options?.format === 'wavsfxm') {
        suffix = 'command';
        const ffmpegPath = path.join(tmpDir, 'ffmpeg');
        await fs.copyFile('./cook/ffmpeg-wav.macosx', ffmpegPath);
        await fs.chmod(ffmpegPath, 0x755);
      }

      const runMePath = path.join(tmpDir, `RunMe.${suffix}`);
      const runMe = createWriteStream(runMePath);
      runMe.write('#!/bin/sh\n');
      await copyFFmpegLicense(runMe, '#   $1');
      runMe.write('\ncd "$(dirname "$0")"\n\n');
      runMe.close();
      await fs.chmod(runMePath, 0x755);
      break;
    }
    case 'powersfxm': {
      await fs.copyFile('./cook/ffmpeg-fat.macosx', path.join(tmpDir, 'ffmpeg'));
      const runMePath = path.join(tmpDir, 'RunMe.command');
      await fs.copyFile('./cook/powersfx.sh', runMePath);
      await fs.chmod(runMePath, 0x755);
      break;
    }
    case 'powersfxu': {
      const runMePath = path.join(tmpDir, 'RunMe.sh');
      await fs.copyFile('./cook/powersfx.sh', runMePath);
      await fs.chmod(runMePath, 0x755);
      break;
    }
  }

  if (projectMode) await fs.mkdir(path.join(tmpDir, `${job.recordingId}_data`));

  await runParallelFunction({
    parallel: job.options?.parallel,
    batchBy: job.options?.batchBy,
    userCount: users.length,
    cancelSignal,
    fn: createTrack
  });

  switch (job.options?.container) {
    case 'mix': {
      const tracks = zip(trackFiles, streamTypes);
      job.setState({ type: 'encoding', progress: 0 });
      await encodeMix({
        recFileBase,
        cancelSignal,
        tracks,
        job,
        encodeCommand: FormatToCommand[job.options?.format || 'flac'],
        audioWritePath: job.outputFile
      });
      break;
    }
    case 'exe': {
      const sfxPath = path.join(process.cwd(), `./cook/${job.options?.format === 'powersfx' ? 'powersfx' : 'sfx'}.exe`);

      job.setState({ type: 'writing', file: 'info.txt' });
      const infoText = await getInfoText(id, info, users, notes);
      await fs.writeFile(path.join(tmpDir, 'info.txt'), infoText);

      job.setState({ type: 'writing', file: 'raw.dat' });
      const rawDatStream = createWriteStream(path.join(tmpDir, 'raw.dat'));
      await recordingWrite({ recFileBase, cancelSignal, writeStream: rawDatStream });

      // Zip up stuff
      job.setState({ type: 'finalizing' });
      await execaCommand(`${pOpts} zip -r -FI - . | cat "${sfxPath}" - > ${job.outputFile}`, {
        cancelSignal,
        timeout: DEF_TIMEOUT,
        shell: true,
        cwd: tmpDir
      });
      break;
    }
    default: {
      // Create project file
      if (projectMode) await fs.writeFile(path.join(tmpDir, 'Extract before opening!.txt'), '');

      switch (job.options?.container) {
        case 'aupzip': {
          const lines = [
            '<?xml version="1.0" standalone="no" ?>',
            '<!DOCTYPE project PUBLIC "-//audacityproject-1.3.0//DTD//EN" "http://audacity.sourceforge.net/xml/audacityproject-1.3.0.dtd" >',
            `<project xmlns="http://audacity.sourceforge.net/xml/" projname="${job.recordingId}_data" version="1.3.0" audacityversion="2.2.2" rate="48000.0">`,
            ...(notes.length !== 0
              ? [
                  '\t<labeltrack name="Craig Notes" height="73" minimized="0">',
                  ...notes.map(
                    (note) =>
                      `\t\t<label t="${note.time}" t1="${note.time}" title="${he
                        .encode(note.note)
                        .replace(/\\/g, '\\$1')
                        .replace(/\n/g, '\\n')
                        .replace(/\r/g, '\\r')}"/>`
                  ),
                  '\t</labeltrack>'
                ]
              : []),
            ...trackFiles.map(
              (file) =>
                `\t<import filename="${path.basename(file)}" offset="0.00000000" mute="0" solo="0" height="150" minimized="0" gain="1.0" pan="0.0"/>`
            ),
            '</project>'
          ];

          await fs.writeFile(path.join(tmpDir, `${job.recordingId}.aup`), lines.join('\n'));
          break;
        }
        case 'sesxzip': {
          const durations = await Promise.all(trackFiles.map((file) => getFileDuration({ cancelSignal, file })));
          const absoluteDuration = Number(durations.sort((a, b) => Number(b) - Number(a))[0]);
          const now = new Date().toISOString();

          const output = source`
            <?xml version="1.0" encoding="UTF-8" standalone="no" ?>
            <!DOCTYPE sesx>
            <sesx version="1.8">
              <session appBuild="13.0.0.519" appVersion="13.0" audioChannelType="stereo" bitDepth="32" duration="${Math.ceil(
                absoluteDuration * 48000
              )}" sampleRate="48000">
                <tracks>
                  ${trackFiles.map((file, i) => {
                    const duration = Math.ceil(Number(durations[i]) * 48000);
                    return stripIndent`
                      <audioTrack automationLaneOpenState="false" id="${i + 10001}" index="${i + 1}" select="true" visible="true">
                        <trackParameters trackHeight="53" trackHue="160" trackMinimized="false">
                          <name>${path.basename(file).split('.')[0]}</name>
                        </trackParameters>
                        <trackAudioParameters audioChannelType="stereo" automationMode="1" monitoring="false" recordArmed="false" solo="false" soloSafe="false">
                          <trackOutput outputID="10000" type="trackID"/>
                          <trackInput inputID="1"/>
                        </trackAudioParameters>
                        <audioClip name="${path.basename(
                          file
                        )}" clipAutoCrossfade="false" startPoint="0" endPoint="${duration}" fileID="${i}" hue="-1" id="0" lockedInTime="false" looped="false" offline="false" select="false" sourceInPoint="0" sourceOutPoint="${duration}" zOrder="2"/>
                      </audioTrack>
                    `;
                  })}
                  <masterTrack automationLaneOpenState="false" id="10000" index="${users.length + 1}" select="false" visible="true">
                    <trackParameters trackHeight="53" trackHue="-1" trackMinimized="false">
                      <name>Master</name>
                    </trackParameters>
                    <trackAudioParameters audioChannelType="stereo" automationMode="1" monitoring="false" recordArmed="false" solo="false" soloSafe="true">
                      <trackOutput outputID="1" type="hardwareOutput"/>
                      <trackInput inputID="-1"/>
                    </trackAudioParameters>
                  </masterTrack>
                </tracks>
                <sessionState ctiPosition="0" smpteStart="0">
                  <timeFormatState beatsPerBar="4" beatsPerMinute="120" customFrameRate="12" linkToDefaultTimeSettings="true" noteLength="4" subdivisions="16" timeCodeDropFrame="false" timeCodeFrameRate="30" timeCodeNTSC="false" timeFormat="timeFormatDecimal"/>
                  <mixingOptionState defaultPanModeLogarithmic="false" panPower="-3" playOverlappingClips="false"/>
                </sessionState>
                <xmpMetadata>
                  <![CDATA[
                    <?xpacket id="W5M0MpCehiHzreSzNTczkc9d"?>
                      <x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c148 79.164036, 2019/08/13-01:06:57        ">
                        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                          <rdf:Description rdf:about=""
                                xmlns:xmp="http://ns.adobe.com/xap/1.0/"
                                xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
                                xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"
                                xmlns:dc="http://purl.org/dc/elements/1.1/"
                                xmlns:xmpDM="http://ns.adobe.com/xmp/1.0/DynamicMedia/">
                            <xmp:CreatorTool>Craig (craig.chat)</xmp:CreatorTool>
                            <xmp:CreateDate>${now}</xmp:CreateDate>
                            <xmp:MetadataDate>${now}</xmp:MetadataDate>
                            <xmp:ModifyDate>${now}</xmp:ModifyDate>
                            <dc:format>application/xml</dc:format>
                            <xmpDM:Tracks>
                              <rdf:Bag>
                                <rdf:li rdf:parseType="Resource">
                                  <xmpDM:trackName>Craig Notes</xmpDM:trackName>
                                  <xmpDM:trackType>Cue</xmpDM:trackType>
                                  <xmpDM:frameRate>f48000</xmpDM:frameRate>
                                  <xmpDM:markers>
                                    <rdf:Seq>
                                      ${notes.map(
                                        (note) => source`
                                          <rdf:li rdf:parseType="Resource">
                                            <xmpDM:startTime>${Math.ceil(Number(note.time) * 48000)}</xmpDM:startTime>
                                            <xmpDM:name>${he.encode(note.note)}</xmpDM:name>
                                          </rdf:li>
                                        `
                                      )}
                                    </rdf:Seq>
                                  </xmpDM:markers>
                                </rdf:li>
                              </rdf:Bag>
                            </xmpDM:Tracks>
                          </rdf:Description>
                        </rdf:RDF>
                      </x:xmpmeta>
                    <?xpacket end="w"?>
                  ]]>
                </xmpMetadata>
              </session>

              <files>
                ${trackFiles.map((file, i) => `<file id="${i}" relativePath="${job.recordingId}_data/${path.basename(file)}"/>`)}
              </files>
            </sesx>
          `;

          await fs.writeFile(path.join(tmpDir, `${job.recordingId}.sesx`), output);
          break;
        }
      }

      job.setState({ type: 'writing', file: 'info.txt' });
      const infoText = await getInfoText(id, info, users, notes);
      await fs.writeFile(path.join(tmpDir, 'info.txt'), infoText);

      job.setState({ type: 'writing', file: 'raw.dat' });
      const rawDatStream = createWriteStream(path.join(tmpDir, 'raw.dat'));
      await recordingWrite({ recFileBase, cancelSignal, writeStream: rawDatStream });

      // Zip up stuff
      job.setState({ type: 'finalizing' });
      await execaCommand(`${pOpts} zip -rFI ${job.outputFile} .`, { cancelSignal, timeout: DEF_TIMEOUT, cwd: tmpDir });
      break;
    }
  }
}
