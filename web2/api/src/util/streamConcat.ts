// https://github.com/sedenardi/node-stream-concat/blob/master/index.js
import { ReadStream } from 'fs';
import { Transform, TransformOptions } from 'stream';

interface StreamConcatOptions extends TransformOptions {
  advanceOnClose?: boolean;
}

type StreamsType = ReadStream[] | (() => ReadStream | Promise<ReadStream>);

export default class StreamConcat extends Transform {
  public streams: StreamsType;
  public options: StreamConcatOptions;
  public canAddStream: boolean;
  public currentStream: ReadStream;
  public streamIndex: number;

  constructor(streams: StreamsType, options: StreamConcatOptions = {}) {
    super(options);
    this.streams = streams;
    this.options = options;
    this.canAddStream = true;
    this.currentStream = null;
    this.streamIndex = 0;

    this.nextStream();
  }
  addStream(newStream) {
    if (!this.canAddStream) return this.emit('error', new Error('Can\'t add stream.'));
    if (Array.isArray(this.streams)) this.streams.push(newStream);
  }
  async nextStream() {
    this.currentStream = null;
    if (this.streams.constructor === Array && this.streamIndex < this.streams.length) {
      this.currentStream = this.streams[this.streamIndex++];
    } else if (typeof this.streams === 'function') {
      this.canAddStream = false;
      this.currentStream = this.streams() as ReadStream;
    }

    const pipeStream = async () => {
      if (this.currentStream === null) {
        this.canAddStream = false;
        this.end();
        // @ts-ignore
      } else if (typeof this.currentStream.then === 'function') {
        this.currentStream = await this.currentStream;
        await pipeStream();
      } else {
        this.currentStream.pipe(this, { end: false });
        let streamClosed = false;
        const goNext = async () => {
          if (streamClosed) {
            return;
          }
          streamClosed = true;
          await this.nextStream();
        };

        this.currentStream.on('end', goNext);
        if (this.options.advanceOnClose) {
          this.currentStream.on('close', goNext);
        }
      }
    };
    await pipeStream();
  }
  _transform(chunk, encoding, callback) {
    callback(null, chunk);
  }
}
