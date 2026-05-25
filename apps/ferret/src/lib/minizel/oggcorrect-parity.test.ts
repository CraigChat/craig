import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { CraigOggState, CraigTrackCorrector, FLAC_TAGS_MAGIC, parseCraigPayload } from './craig';
import { createPage } from './ogg';
import { FLAC, SILENT_FLAC_44K, SILENT_FLAC_48K, SILENT_OPUS } from './util';

const text = new TextEncoder();
const OGG_CORRECT = join(process.cwd(), '../kitchen/cook/oggcorrect');
const VAD_HEADER = new Uint8Array([0x45, 0x43, 0x56, 0x41, 0x44, 0x44, 0x03, 0x00, 0x00, 0x03, 0x01]);
const VOICE_OPUS = new Uint8Array([0xfc, 0xff, 0xfe, 1, 2, 3, 4, 5]);

type FixturePage = {
  serial: number;
  granulePosition: bigint;
  payload: Uint8Array;
  headerType?: number;
};

type CorrectedSummary = {
  granulePosition: bigint;
  payload: number[];
};

function withVad(payload: Uint8Array) {
  const out = new Uint8Array(VAD_HEADER.length + payload.length);
  out.set(VAD_HEADER);
  out.set(payload, VAD_HEADER.length);
  return out;
}

function opusHeader() {
  return new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0]);
}

function flacHeader(sampleRate: number) {
  const out = new Uint8Array(52);
  out.set(FLAC);
  out[5] = 1;
  out[8] = 3;
  out[9] = 0x66;
  out[10] = 0x4c;
  out[11] = 0x61;
  out[12] = 0x43;
  out[16] = 34;
  out[27] = (sampleRate >> 12) & 0xff;
  out[28] = (sampleRate >> 4) & 0xff;
  out[29] = (sampleRate & 0x0f) << 4;
  return out;
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function fixtureToOgg(pages: FixturePage[]) {
  return concatBytes(
    pages.map((page, index) =>
      createPage({
        version: 0,
        headerType: page.headerType ?? (page.granulePosition === 0n ? 2 : 0),
        granulePosition: page.granulePosition,
        bitstreamSerialNumber: page.serial,
        pageSequenceNumber: index,
        payload: page.payload
      })
    )
  );
}

function parseOggPages(bytes: Uint8Array): FixturePage[] {
  const pages: FixturePage[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    assert.deepEqual([...bytes.subarray(offset, offset + 4)], [0x4f, 0x67, 0x67, 0x53]);
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const segmentCount = view.getUint8(26);
    const segmentTable = bytes.subarray(offset + 27, offset + 27 + segmentCount);
    const payloadLength = segmentTable.reduce((sum, segment) => sum + segment, 0);
    const payloadOffset = offset + 27 + segmentCount;
    pages.push({
      serial: view.getUint32(14, true),
      granulePosition: view.getBigUint64(6, true),
      headerType: view.getUint8(5),
      payload: bytes.slice(payloadOffset, payloadOffset + payloadLength)
    });
    offset = payloadOffset + payloadLength;
  }

  return pages;
}

function summarizeCorrectedData(pages: FixturePage[]): CorrectedSummary[] {
  return pages
    .filter((page) => parseCraigPayload(page.payload, 'flac').kind !== 'audio-header')
    .map((page) => ({
      granulePosition: page.granulePosition,
      payload: [...page.payload]
    }));
}

function runOggCorrect(pages: FixturePage[], keepSerial: number): CorrectedSummary[] {
  const fixture = fixtureToOgg(pages);
  const result = spawnSync(OGG_CORRECT, [String(keepSerial)], {
    input: concatBytes([fixture, fixture]),
    maxBuffer: 1024 * 1024
  });

  assert.equal(result.status, 0, result.stderr.toString());
  return summarizeCorrectedData(parseOggPages(result.stdout));
}

function runMinizelStreamCorrection(pages: FixturePage[], keepSerial: number): CorrectedSummary[] {
  const state = new CraigOggState();
  const correctors = new Map<number, CraigTrackCorrector>();
  const corrected: FixturePage[] = [];
  let keptType: 'opus' | 'flac' = 'opus';
  let keptFlacRate = 48_000;

  pages.forEach((page, index) => {
    const event = state.acceptPage({
      serial: page.serial,
      granulePosition: page.granulePosition,
      headerType: page.headerType ?? (page.granulePosition === 0n ? 2 : 0),
      pageSequenceNumber: index,
      payload: page.payload
    });
    if (!event || event.serial !== keepSerial) return;
    if (event.kind === 'audio-header') {
      keptType = event.type;
      keptFlacRate = event.flacRate ?? keptFlacRate;
      if (!correctors.has(event.serial)) {
        correctors.set(event.serial, new CraigTrackCorrector({ type: event.type, flacRate: event.flacRate }));
      }
      return;
    }
    if (event.kind !== 'audio-packet') return;

    let corrector = correctors.get(event.serial);
    if (!corrector) {
      corrector = new CraigTrackCorrector({ type: event.type, flacRate: event.flacRate });
      correctors.set(event.serial, corrector);
    }

    const outputs = corrector.acceptPacket({
      granulePosition: event.inputGranulePosition,
      payload: event.payload,
      framesInPacket: event.framesInPacket,
      frameSize: event.frameSize
    });
    for (const output of outputs) {
      const payload =
        output.kind === 'silence' ? (event.type === 'opus' ? SILENT_OPUS : event.flacRate === 44_100 ? SILENT_FLAC_44K : SILENT_FLAC_48K) : output.payload;
      corrected.push({ serial: keepSerial, granulePosition: output.granulePosition, payload });
    }
  });

  const corrector = correctors.get(keepSerial);
  if (corrector) {
    for (const output of corrector.finish()) {
      const payload =
        output.kind === 'silence' ? (keptType === 'opus' ? SILENT_OPUS : keptFlacRate === 44_100 ? SILENT_FLAC_44K : SILENT_FLAC_48K) : output.payload;
      corrected.push({ serial: keepSerial, granulePosition: output.granulePosition, payload });
    }
  }

  return summarizeCorrectedData(corrected);
}

function assertStreamMatchesOggCorrect(name: string, pages: FixturePage[], keepSerial: number) {
  test(name, { skip: !existsSync(OGG_CORRECT) ? 'apps/kitchen/cook/oggcorrect must be built first' : false }, () => {
    assert.deepEqual(runMinizelStreamCorrection(pages, keepSerial), runOggCorrect(pages, keepSerial));
  });
}

assertStreamMatchesOggCorrect(
  'streaming correction matches oggcorrect for leading silence, gaps, and late drops',
  [
    { serial: 1, granulePosition: 0n, payload: opusHeader() },
    { serial: 2, granulePosition: 0n, payload: opusHeader() },
    { serial: 1, granulePosition: 960n, payload: VOICE_OPUS },
    { serial: 2, granulePosition: 3_840n, payload: VOICE_OPUS },
    { serial: 2, granulePosition: 4_800n, payload: VOICE_OPUS },
    { serial: 2, granulePosition: 35_520n, payload: VOICE_OPUS },
    { serial: 2, granulePosition: 1_920n, payload: VOICE_OPUS }
  ],
  2
);

assertStreamMatchesOggCorrect(
  'streaming correction matches oggcorrect for VAD-prefixed Opus tracks',
  [
    { serial: 1, granulePosition: 0n, payload: opusHeader() },
    { serial: 2, granulePosition: 0n, payload: withVad(opusHeader()) },
    { serial: 1, granulePosition: 960n, payload: VOICE_OPUS },
    { serial: 2, granulePosition: 2_880n, payload: new Uint8Array([2, ...VOICE_OPUS]) },
    { serial: 2, granulePosition: 3_840n, payload: new Uint8Array([0, ...VOICE_OPUS]) },
    { serial: 2, granulePosition: 4_800n, payload: new Uint8Array([2, ...VOICE_OPUS]) }
  ],
  2
);

assertStreamMatchesOggCorrect(
  'streaming correction matches oggcorrect for pause resume metadata',
  [
    { serial: 9, granulePosition: 0n, payload: text.encode('ECMETAxx') },
    { serial: 2, granulePosition: 0n, payload: opusHeader() },
    { serial: 2, granulePosition: 960n, payload: VOICE_OPUS },
    { serial: 9, granulePosition: 1_920n, payload: text.encode('{"c":"pause"}') },
    { serial: 9, granulePosition: 11_520n, payload: text.encode('{"c":"resume"}') },
    { serial: 2, granulePosition: 12_480n, payload: VOICE_OPUS },
    { serial: 2, granulePosition: 13_440n, payload: VOICE_OPUS }
  ],
  2
);

assertStreamMatchesOggCorrect(
  'streaming correction matches oggcorrect for 44.1k FLAC granules',
  [
    { serial: 1, granulePosition: 0n, payload: opusHeader() },
    { serial: 2, granulePosition: 0n, payload: flacHeader(44_100) },
    { serial: 2, granulePosition: 0n, payload: new Uint8Array([...FLAC_TAGS_MAGIC, ...text.encode('tag')]) },
    { serial: 1, granulePosition: 960n, payload: VOICE_OPUS },
    { serial: 2, granulePosition: 2_880n, payload: new Uint8Array([0xff, 0xf8, 0x79, 0x0c, 0, 3, 0x71, 0x56, 0, 0, 0, 0, 0x63, 0xc5, 1, 2]) },
    { serial: 2, granulePosition: 3_840n, payload: new Uint8Array([0xff, 0xf8, 0x79, 0x0c, 0, 3, 0x71, 0x56, 0, 0, 0, 0, 0x63, 0xc5, 3, 4]) }
  ],
  2
);

assertStreamMatchesOggCorrect(
  'streaming correction matches oggcorrect for header-only tracks',
  [
    { serial: 1, granulePosition: 0n, payload: opusHeader() },
    { serial: 2, granulePosition: 0n, payload: opusHeader() },
    { serial: 2, granulePosition: 0n, payload: new TextEncoder().encode('OpusTags') },
    { serial: 1, granulePosition: 960n, payload: VOICE_OPUS }
  ],
  2
);
