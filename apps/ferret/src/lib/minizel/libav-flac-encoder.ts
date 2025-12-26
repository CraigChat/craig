import { newQueue } from '@henrygd/queue';
import LibAV from '@libav.js/variant-webcodecs';
import { type AudioCodec, AudioSample, CustomAudioEncoder, EncodedPacket } from 'mediabunny';

import { Bitstream } from './bitstream';

const FLAC_HEADER = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);

export class LibAVFlacEncoder extends CustomAudioEncoder {
  private _libav?: LibAV.LibAV;
  private _c?: number;
  private _frame?: number;
  private _pkt?: number;
  private _q = newQueue(1);
  private meta?: EncodedAudioChunkMetadata;

  static override supports(codec: AudioCodec, config: AudioDecoderConfig): boolean {
    return codec === 'flac' && config.numberOfChannels === 2;
  }

  async init() {
    this._libav = await LibAV.LibAV({
      variant: 'webcodecs',
      base: '/_libav'
    });
  }

  #toS16(audioSample: AudioSample) {
    const arrayBuffer = new ArrayBuffer(audioSample.allocationSize({ planeIndex: 0, format: 's16' }));
    audioSample.copyTo(arrayBuffer, { planeIndex: 0, format: 's16' });
    return new Int16Array(arrayBuffer);
  }

  async #getMeta(audioSample: AudioSample) {
    if (this.meta) return this.meta;
    const extradataPtr = await this._libav!.AVCodecContext_extradata(this._c!);
    const extradata_size = await this._libav!.AVCodecContext_extradata_size(this._c!);
    let description: Uint8Array | undefined = undefined;
    if (extradataPtr && extradata_size) {
      const meta = await this._libav!.copyout_u8(extradataPtr, extradata_size);
      const headerBitstream = new Bitstream(new Uint8Array(4));
      headerBitstream.writeBits(1, 1); // isLastMetadata
      headerBitstream.writeBits(7, 0); // metaBlockType = streaminfo
      headerBitstream.writeBits(24, meta.length); // size
      description = new Uint8Array(4 + 4 + meta.length);
      description.set(FLAC_HEADER, 0);
      description.set(headerBitstream.bytes, 4);
      description.set(meta, 8);
    }

    this.meta = {
      decoderConfig: {
        sampleRate: audioSample.sampleRate,
        numberOfChannels: audioSample.numberOfChannels,
        codec: 'flac',
        description
      }
    };
    return this.meta;
  }

  async encode(audioSample: AudioSample) {
    if (!this._libav) throw new TypeError('No LibAV');

    const format = LibAV.AV_SAMPLE_FMT_S16;
    const raw = this.#toS16(audioSample);
    const nb_samples = audioSample.allocationSize({ planeIndex: 0, format: 'u8-planar' });

    // Convert the timestamp
    const [pts, ptshi] = LibAV.f64toi64(audioSample.timestamp);

    // Convert the channel layout
    const cc = audioSample.numberOfChannels;
    const channel_layout = cc === 1 ? 4 : (1 << cc) - 1;

    // Make the frame
    const sample_rate = audioSample.sampleRate;
    const frame: LibAV.Frame = {
      data: raw,
      format,
      pts,
      ptshi,
      channel_layout,
      sample_rate,
      nb_samples
    };

    return this._q.add(async () => {
      if (!this._libav) throw new TypeError('No LibAV');
      if (!this._c) {
        const [, c, frame, pkt] = await this._libav.ff_init_encoder('flac', {
          ctx: {
            sample_fmt: LibAV.AV_SAMPLE_FMT_S16,
            bit_rate: 0,
            sample_rate,
            channel_layout,
            channels: cc,
            frame_size: 0
          },
          time_base: [1, sample_rate]
        });

        this._c = c;
        this._frame = frame;
        this._pkt = pkt;
      }

      // Set the current frame size to match this frame's nb_samples
      await this._libav.AVCodecContext_frame_size_s(this._c!, nb_samples);

      const encodedOutputs = await this._libav.ff_encode_multi(this._c!, this._frame!, this._pkt!, [frame]);
      for (const packet of encodedOutputs)
        this.onPacket(
          new EncodedPacket(
            packet.data,
            'key',
            packet.time_base_num! / packet.time_base_den!,
            LibAV.i64tof64(packet.duration!, packet.durationhi || 0) / 1000
          ),
          await this.#getMeta(audioSample)
        );
    });
  }

  async flush() {
    this._q.add(async () => {
      if (!this._libav) throw new TypeError('No LibAV');
      const encodedOutputs = await this._libav.ff_encode_multi(this._c!, this._frame!, this._pkt!, [], true);
      for (const packet of encodedOutputs)
        if (packet.data.length)
          this.onPacket(
            new EncodedPacket(
              packet.data,
              'key',
              packet.time_base_num! / packet.time_base_den!,
              LibAV.i64tof64(packet.duration!, packet.durationhi || 0) / 1000
            ),
            this.meta!
          );
    });
    await this._q.done();
  }

  async close() {
    if (this._c) {
      this._q.clear();
      await this._libav?.ff_free_encoder(this._c!, this._frame!, this._pkt!);
      this._c = this._frame = this._pkt = 0;
    }
    this._libav?.worker?.terminate();
    this._libav = undefined;
  }
}
