import type { queueAsPromised } from 'fastq';
import * as fastq from 'fastq';
import { createWriteStream, WriteStream } from 'fs';

import OggEncoder, { BOS } from './ogg';
import Recording, { Chunk, NOTE_TRACK_NUMBER, RecordingUser } from './recording';
import {
  EMPTY_BUFFER,
  FLAC_HEADER_44k,
  FLAC_HEADER_44k_VAD,
  FLAC_HEADER_48k,
  FLAC_HEADER_48k_VAD,
  FLAC_TAGS,
  OPUS_HEADERS,
  OPUS_HEADERS_MONO,
  OPUS_MONO_HEADER_VAD
} from './util';

export type WriteTask =
  | {
      type: 'writeChunk';
      streamNo: number;
      packetNo: number;
      chunk: Chunk;
      buffer: Buffer;
    }
  | {
      type: 'writeData';
      granulePos: number;
      streamNo: number;
      packetNo: number;
      buffer: Buffer;
    }
  | {
      type: 'writeUserHeader';
      user: RecordingUser;
    }
  | {
      type: 'writeUser';
      user: RecordingUser;
    }
  | {
      type: 'writeNoteHeader';
    }
  | {
      type: 'writeNote';
      chunkGranule: number;
      packetNo: number;
      buffer: Buffer;
    }
  | {
      type: 'writeLog';
      message: string;
    };

export default class RecordingWriter {
  recording: Recording;
  fileBase: string;
  dataEncoder: OggEncoder;
  usersStream: WriteStream;
  logStream: WriteStream;
  headerEncoder1: OggEncoder;
  headerEncoder2: OggEncoder;

  q: queueAsPromised<WriteTask>;
  closed = false;

  constructor(recording: Recording, fileBase: string) {
    this.recording = recording;
    this.fileBase = fileBase;
    this.dataEncoder = new OggEncoder(createWriteStream(fileBase + '.data'));
    this.headerEncoder1 = new OggEncoder(createWriteStream(fileBase + '.header1'));
    this.headerEncoder2 = new OggEncoder(createWriteStream(fileBase + '.header2'));
    this.usersStream = createWriteStream(fileBase + '.users');
    this.usersStream.write('"0":{}\n');
    this.logStream = createWriteStream(fileBase + '.log');

    this.q = fastq.promise(this.writeWorker.bind(this), 1);
  }

  writeChunk(streamNo: number, packetNo: number, chunk: Chunk, buffer: Buffer) {
    try {
      if (this.recording.increaseBytesWritten(buffer.length)) return;
      this.dataEncoder.write(chunk.time, streamNo, packetNo, buffer);
      // Then the timestamp for reference
      this.dataEncoder.write(chunk.timestamp ? chunk.timestamp : 0, streamNo, packetNo + 1, EMPTY_BUFFER);
    } catch (e) {
      this.recording.recorder.logger.error(`Tried to write to stream! (stream: ${streamNo}, packet: ${packetNo}, recording: ${this.recording.id})`);
    }
  }

  writeData(granulePos: number, streamNo: number, packetNo: number, buffer: Buffer) {
    try {
      if (this.recording.increaseBytesWritten(buffer.length)) return;
      this.dataEncoder.write(granulePos, streamNo, packetNo, buffer);
    } catch (e) {
      this.recording.recorder.logger.error(
        `Tried to write data to stream! (stream: ${streamNo}, packet: ${packetNo}, recording: ${this.recording.id})`
      );
    }
  }

  writeUserHeader(user: RecordingUser) {
    try {
      this.headerEncoder1.write(0, user.track, 0, OPUS_HEADERS[0], BOS);
      this.headerEncoder2.write(0, user.track, 1, OPUS_HEADERS[1]);
    } catch (e) {
      this.recording.recorder.logger.error(`Failed to write headers for recording ${this.recording.id}`, e);
      this.recording.writeToLog(`Failed to write headers on track ${user.track} (${user.username}#${user.discriminator}): ${e}`);
    }
  }

  writeUser(user: RecordingUser) {
    try {
      this.usersStream.write(
        `,"${user.track}":${JSON.stringify({
          ...user,
          track: undefined,
          packet: undefined
        })}\n`
      );
    } catch (e) {
      this.recording.recorder.logger.error(`Failed to write user for recording ${this.recording.id}`, e);
      this.recording.writeToLog(`Failed to write user on track ${user.track} (${user.username}#${user.discriminator}): ${e}`);
    }
  }

  writeNoteHeader() {
    try {
      this.headerEncoder1.write(0, NOTE_TRACK_NUMBER, 0, Buffer.from('STREAMNOTE'), BOS);
    } catch (e) {
      this.recording.recorder.logger.error(`Failed to write note header for recording ${this.recording.id}`, e);
      this.recording.writeToLog(`Failed to write note header: ${e}`);
    }
  }

  writeNote(chunkGranule: number, packetNo: number, buffer: Buffer) {
    try {
      this.dataEncoder.write(chunkGranule, NOTE_TRACK_NUMBER, packetNo, buffer);
    } catch (e) {
      this.recording.recorder.logger.error(`Failed to write note for recording ${this.recording.id}`, e);
      this.recording.writeToLog(`Failed to write note: ${e}`);
    }
  }

  writeLog(message: string) {
    if (!this.logStream.destroyed) this.logStream.write(message);
  }

  async writeWorker(task: WriteTask) {
    if (this.closed) return;
    switch (task.type) {
      case 'writeChunk': {
        const { streamNo, packetNo, chunk, buffer } = task;
        try {
          if (this.recording.increaseBytesWritten(buffer.length)) return;
          this.dataEncoder.write(chunk.time, streamNo, packetNo, buffer);
          // Then the timestamp for reference
          this.dataEncoder.write(chunk.timestamp ? chunk.timestamp : 0, streamNo, packetNo + 1, EMPTY_BUFFER);
        } catch (e) {
          this.recording.recorder.logger.error(
            `Tried to write to stream! (stream: ${streamNo}, packet: ${packetNo}, recording: ${this.recording.id})`
          );
        }
        break;
      }
      case 'writeData': {
        const { granulePos, streamNo, packetNo, buffer } = task;
        try {
          if (this.recording.increaseBytesWritten(buffer.length)) return;
          this.dataEncoder.write(granulePos, streamNo, packetNo, buffer);
        } catch (e) {
          this.recording.recorder.logger.error(
            `Tried to write data to stream! (stream: ${streamNo}, packet: ${packetNo}, recording: ${this.recording.id})`
          );
        }
        break;
      }
      case 'writeUserHeader': {
        const { user } = task;
        try {
          this.headerEncoder1.write(0, user.track, 0, OPUS_HEADERS[0], BOS);
          this.headerEncoder2.write(0, user.track, 1, OPUS_HEADERS[1]);
        } catch (e) {
          this.recording.recorder.logger.error(`Failed to write headers for recording ${this.recording.id}`, e);
          this.recording.writeToLog(`Failed to write headers on track ${user.track} (${user.username}#${user.discriminator}): ${e}`);
        }
        break;
      }
      case 'writeUser': {
        const { user } = task;
        try {
          this.usersStream.write(
            `,"${user.track}":${JSON.stringify({
              ...user,
              track: undefined,
              packet: undefined
            })}\n`
          );
        } catch (e) {
          this.recording.recorder.logger.error(`Failed to write user for recording ${this.recording.id}`, e);
          this.recording.writeToLog(`Failed to write user on track ${user.track} (${user.username}#${user.discriminator}): ${e}`);
        }
        break;
      }
      case 'writeNoteHeader': {
        try {
          this.headerEncoder1.write(0, NOTE_TRACK_NUMBER, 0, Buffer.from('STREAMNOTE'), BOS);
        } catch (e) {
          this.recording.recorder.logger.error(`Failed to write note header for recording ${this.recording.id}`, e);
          this.recording.writeToLog(`Failed to write note header: ${e}`);
        }
        break;
      }
      case 'writeNote': {
        const { chunkGranule, packetNo, buffer } = task;
        try {
          this.dataEncoder.write(chunkGranule, NOTE_TRACK_NUMBER, packetNo, buffer);
        } catch (e) {
          this.recording.recorder.logger.error(`Failed to write note for recording ${this.recording.id}`, e);
          this.recording.writeToLog(`Failed to write note: ${e}`);
        }
        break;
      }
      case 'writeLog': {
        const { message } = task;
        if (!this.logStream.destroyed) this.logStream.write(message);
        break;
      }
    }
  }

  async end() {
    this.closed = true;
    if (!this.q.idle()) await this.q.drained();
    this.dataEncoder.end();
    this.headerEncoder1.end();
    this.headerEncoder2.end();
    this.usersStream.end();
    this.logStream.end();
  }
}
