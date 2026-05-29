import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CraigOggState,
  CraigTrackCorrector,
  FLAC_TAGS_MAGIC,
  makePlanarF32,
  normalizeAudioToStereo,
  parseCraigPayload,
  stripVadPacket
} from './craig';
import { MixedProcessor } from './mixed-processor';
import { createPage } from './ogg';
import { getFramesInPacket, getFrameSize } from './opus';
import { MinizelProcessor } from './processor';
import { FLAC, OPUS, SILENT_OPUS } from './util';

const text = new TextEncoder();
const VAD_HEADER = new Uint8Array([0x45, 0x43, 0x56, 0x41, 0x44, 0x44, 0x03, 0x00, 0x00, 0x03, 0x01]);

function withVad(payload: Uint8Array) {
  const out = new Uint8Array(VAD_HEADER.length + payload.length);
  out.set(VAD_HEADER);
  out.set(payload, VAD_HEADER.length);
  return out;
}

function opusHeader(channels = 2) {
  const out = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, channels, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0]);
  return out;
}

function flacHeader(sampleRate = 48_000) {
  const out = new Uint8Array(52);
  out.set(FLAC);
  out[5] = 1;
  out[8] = 3;
  out[9] = 0x66;
  out[10] = 0x4c;
  out[11] = 0x61;
  out[12] = 0x43;
  out[16] = 34;
  out[18] = 0x03;
  out[19] = sampleRate === 44_100 ? 0x72 : 0xc0;
  out[20] = sampleRate === 44_100 ? 0x03 : 0x03;
  out[21] = sampleRate === 44_100 ? 0x72 : 0xc0;
  out[27] = (sampleRate >> 12) & 0xff;
  out[28] = (sampleRate >> 4) & 0xff;
  out[29] = (sampleRate & 0x0f) << 4;
  return out;
}

test('parseCraigPayload strips VAD header and detects Opus headers', () => {
  const parsed = parseCraigPayload(withVad(opusHeader(1)), undefined);

  assert.equal(parsed.kind, 'audio-header');
  assert.equal(parsed.type, 'opus');
  assert.equal(parsed.vadWrapped, true);
  assert.deepEqual([...parsed.payload.subarray(0, 8)], [...OPUS, 0x48, 0x65, 0x61, 0x64]);
});

test('parseCraigPayload detects FLAC sample rate behind VAD headers and FLAC tag pages', () => {
  const header = parseCraigPayload(withVad(flacHeader(44_100)), undefined);
  assert.equal(header.kind, 'audio-header');
  assert.equal(header.type, 'flac');
  assert.equal(header.flacRate, 44_100);

  const tags = parseCraigPayload(new Uint8Array([...FLAC_TAGS_MAGIC, ...text.encode('ennuicastr')]), 'flac');
  assert.equal(tags.kind, 'audio-header');
  assert.equal(tags.type, 'flac');
  assert.deepEqual([...tags.payload.subarray(0, 4)], [...FLAC_TAGS_MAGIC]);
});

test('VAD-wrapped data strips its transport byte without interpreting its value', () => {
  const packet = new Uint8Array([0, 0xfc, 0xff, 0xfe]);

  assert.deepEqual([...stripVadPacket(packet, true)], [0xfc, 0xff, 0xfe]);
});

test('CraigOggState applies pause/resume metadata to later packet positions', () => {
  const state = new CraigOggState();

  state.acceptPage({ serial: 9, granulePosition: 0n, headerType: 2, pageSequenceNumber: 0, payload: text.encode('ECMETAxx') });
  state.acceptPage({ serial: 1, granulePosition: 0n, headerType: 2, pageSequenceNumber: 0, payload: opusHeader() });
  state.acceptPage({ serial: 1, granulePosition: 4_800n, headerType: 0, pageSequenceNumber: 2, payload: new Uint8Array([0xf8, 0xff, 0xfe]) });
  state.acceptPage({ serial: 9, granulePosition: 9_600n, headerType: 0, pageSequenceNumber: 1, payload: text.encode('{"c":"pause"}') });
  state.acceptPage({ serial: 9, granulePosition: 19_200n, headerType: 0, pageSequenceNumber: 2, payload: text.encode('{"c":"resume"}') });
  const event = state.acceptPage({
    serial: 1,
    granulePosition: 24_000n,
    headerType: 0,
    pageSequenceNumber: 3,
    payload: new Uint8Array([0xf8, 0xff, 0xfe])
  });

  assert.equal(event?.kind, 'audio-packet');
  assert.equal(event.inputGranulePosition, 9_600n);
});

test('CraigTrackCorrector inserts silence for true gaps and drops late packets', () => {
  const corrector = new CraigTrackCorrector({ type: 'opus', flacRate: 48_000 });
  const first = corrector.acceptPacket({ granulePosition: 0n, payload: SILENT_OPUS, framesInPacket: 1, frameSize: 960 });
  const gap = corrector.acceptPacket({ granulePosition: 30_720n, payload: new Uint8Array([0xfc, 0xff, 0xfe]), framesInPacket: 1, frameSize: 960 });
  const late = corrector.acceptPacket({ granulePosition: 960n, payload: new Uint8Array([0xfc, 0xff, 0xfe]), framesInPacket: 1, frameSize: 960 });
  const end = corrector.finish();

  assert.equal(first.length, 0);
  assert.deepEqual(
    gap.map((p) => p.kind),
    ['packet']
  );
  assert.equal(late.length, 0);
  assert.equal(end.filter((p) => p.kind === 'silence').length, 31);
  assert.equal(end.at(-1)?.kind, 'packet');
});

test('CraigTrackCorrector preserves leading silence before a late first voice packet', () => {
  const corrector = new CraigTrackCorrector({ type: 'opus', flacRate: 48_000 });
  const initial = corrector.acceptPacket({ granulePosition: 2_880n, payload: new Uint8Array([0xfc, 0xff, 0xfe]), framesInPacket: 1, frameSize: 960 });
  const packets = corrector.finish();

  assert.deepEqual(initial, []);
  assert.deepEqual(
    packets.map((p) => p.kind),
    ['silence', 'silence', 'silence', 'packet']
  );
  assert.deepEqual(
    packets.map((p) => p.granulePosition),
    [0n, 960n, 1_920n, 2_880n]
  );
});

test('CraigTrackCorrector converts 44.1k FLAC output granules', () => {
  const corrector = new CraigTrackCorrector({ type: 'flac', flacRate: 44_100 });
  corrector.acceptPacket({ granulePosition: 960n, payload: new Uint8Array([1, 2, 3]), framesInPacket: 1, frameSize: 960 });
  const packets = corrector.finish();

  assert.deepEqual(
    packets.map((p) => p.granulePosition),
    [0n, 882n]
  );
});

test('CraigTrackCorrector reorders packets within its streaming correction horizon', () => {
  const corrector = new CraigTrackCorrector({ type: 'opus' });
  const later = new Uint8Array([0xfc, 0xff, 0xfe, 2]);
  const earlier = new Uint8Array([0xfc, 0xff, 0xfe, 1]);

  assert.deepEqual(corrector.acceptPacket({ granulePosition: 1_920n, payload: later, framesInPacket: 1, frameSize: 960 }), []);
  assert.deepEqual(corrector.acceptPacket({ granulePosition: 960n, payload: earlier, framesInPacket: 1, frameSize: 960 }), []);
  const packets = corrector.finish();

  assert.deepEqual(
    packets.filter((packet) => packet.kind === 'packet').map((packet) => [...packet.payload]),
    [[...earlier], [...later]]
  );
});

test('CraigTrackCorrector emits a playable silence packet for header-only tracks', () => {
  const outputs = new CraigTrackCorrector({ type: 'opus' }).finish();

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0]?.kind, 'silence');
  assert.equal(outputs[0]?.granulePosition, 0n);
});

test('normalizeAudioToStereo duplicates mono and truncates extra channels', () => {
  const mono = normalizeAudioToStereo([new Float32Array([0.5, 0.25])]);
  assert.equal(mono.length, 2);
  assert.deepEqual([...mono[0]!], [0.5, 0.25]);
  assert.deepEqual([...mono[1]!], [0.5, 0.25]);

  const surround = normalizeAudioToStereo([new Float32Array([1]), new Float32Array([2]), new Float32Array([3])]);
  assert.deepEqual(
    surround.map((c) => c[0]),
    [1, 2]
  );
});

test('makePlanarF32 packs stereo channels for Mediabunny AudioSample', () => {
  const planar = makePlanarF32([new Float32Array([1, 2]), new Float32Array([3, 4])]);

  assert.deepEqual([...planar], [1, 2, 3, 4]);
});

test('Opus packet helpers preserve kitchen frame sizing assumptions', () => {
  assert.equal(getFramesInPacket(new Uint8Array([0xf8, 0xff, 0xfe])), 1);
  assert.equal(getFrameSize(new Uint8Array([0xf8, 0xff, 0xfe])), 960);
  assert.equal(getFrameSize(new Uint8Array([0x88])), 240);
});

test('createPage preserves FLAC tag page payloads after normalization', () => {
  const payload = new Uint8Array([...FLAC_TAGS_MAGIC, ...text.encode('tag')]);
  const page = createPage({
    version: 0,
    headerType: 0,
    granulePosition: 0n,
    bitstreamSerialNumber: 2,
    pageSequenceNumber: 1,
    payload
  });

  const headerTotalLen = 27 + page[26]!;
  assert.deepEqual([...page.subarray(headerTotalLen)], [...payload]);
});

test('MixedProcessor finalizes only real cached timeline content', async () => {
  const processor = new MixedProcessor({ reader: null!, fileHandle: null!, format: 'wav' }) as any;
  const blocks: number[] = [];
  processor.enqueueSample = async (_left: Float32Array, _right: Float32Array, start: number) => blocks.push(start);
  processor.mixCache = [{ left: new Float32Array(960).fill(0.25), right: new Float32Array(960).fill(0.25), length: 960, granulePosition: 0 }];

  await processor.processMix(true);

  assert.deepEqual(blocks, [0]);
});

test('MixedProcessor normalizes simultaneous inputs like FFmpeg amix defaults', async () => {
  const processor = new MixedProcessor({ reader: null!, fileHandle: null!, format: 'wav' }) as any;
  let left: Float32Array | undefined;
  processor.enqueueSample = async (outputLeft: Float32Array) => {
    left = outputLeft;
  };
  processor.mixCache = [
    { left: new Float32Array(960).fill(0.8), right: new Float32Array(960).fill(0.8), length: 960, granulePosition: 0 },
    { left: new Float32Array(960).fill(0.8), right: new Float32Array(960).fill(0.8), length: 960, granulePosition: 0 }
  ];

  await processor.processMix(true);

  assert.ok(Math.abs(left![0]! - 0.8) < 1e-6);
});

test('MixedProcessor normalizes against silent active timeline input', async () => {
  const processor = new MixedProcessor({ reader: null!, fileHandle: null!, format: 'wav' }) as any;
  let left: Float32Array | undefined;
  processor.enqueueSample = async (outputLeft: Float32Array) => {
    left = outputLeft;
  };
  processor.mixCache = [
    { left: new Float32Array(960).fill(0.8), right: new Float32Array(960).fill(0.8), length: 960, granulePosition: 0 },
    { left: new Float32Array(960), right: new Float32Array(960), length: 960, granulePosition: 0 }
  ];

  await processor.processMix(true);

  assert.ok(Math.abs(left![0]! - 0.4) < 1e-6);
});

test('MixedProcessor retains inserted silence packets as active mix timeline', async () => {
  const processor = new MixedProcessor({ reader: null!, fileHandle: null!, format: 'wav' }) as any;
  let task: Promise<void> | undefined;
  processor.decodingQueue = { add: (run: () => Promise<void>) => (task = run()) };
  processor.processMix = async () => {};

  processor.enqueueCorrectedPackets('opus', [
    { kind: 'silence', payload: new Uint8Array(0), logicalGranulePosition: 0n, granulePosition: 0n, durationSamples: 960n }
  ]);
  await task;

  assert.equal(processor.mixCache.length, 1);
  assert.equal(processor.mixCache[0]!.granulePosition, 0);
  assert.equal(processor.mixCache[0]!.length, 960);
});

test('MixedProcessor preserves audio beginning inside a final mix block', async () => {
  const processor = new MixedProcessor({ reader: null!, fileHandle: null!, format: 'wav' }) as any;
  const blocks: Float32Array[] = [];
  processor.enqueueSample = async (left: Float32Array) => blocks.push(left);
  processor.mixCache = [{ left: new Float32Array(960).fill(0.5), right: new Float32Array(960).fill(0.5), length: 960, granulePosition: 1_440 }];

  await processor.processMix(true);

  assert.equal(blocks[1]?.[480], 0.5);
  assert.equal(blocks[2]?.[0], 0.5);
});

test('processors retain parser worker errors, wake processing, and cancel input', async () => {
  for (const processor of [
    new MinizelProcessor({ reader: null!, directoryHandle: null!, format: 'ogg' }),
    new MixedProcessor({ reader: null!, fileHandle: null!, format: 'wav' })
  ] as any[]) {
    let cancelledWith: Error | undefined;
    let workerWoken = false;
    processor.reader = {
      cancel: async (reason: Error) => {
        cancelledWith = reason;
      }
    };
    processor._workerDone = () => (workerWoken = true);

    processor.failWorker('bad page');
    await Promise.resolve();

    assert.match(processor.workerError.message, /bad page/);
    assert.equal(cancelledWith, processor.workerError);
    assert.equal(workerWoken, true);
  }
});

test('MinizelProcessor finalizes outputs created while queued writes drain', async () => {
  const processor = new MinizelProcessor({ reader: null!, directoryHandle: null!, format: 'ogg' }) as any;
  let closed = false;
  processor.queues.set(4, {
    done: async () => {
      processor.writers.set(4, { close: async () => (closed = true) });
    }
  });
  processor.flushWriterCache = async () => {};

  await processor.finalizeOutputs();

  assert.equal(closed, true);
});
