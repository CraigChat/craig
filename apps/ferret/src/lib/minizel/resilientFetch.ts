/**
 * Resilient fetch for streaming large files with automatic retry/resume on connection drops.
 * Uses HTTP Range requests to resume from where the connection was lost.
 */

export interface ResilientFetchOptions {
  /** Maximum number of retry attempts (default: 10) */
  maxRetries?: number;
  /** Base delay between retries in ms (default: 1000) */
  retryDelay?: number;
  /** Abort signal to cancel the entire operation */
  signal?: AbortSignal;
  /** Callback when a retry occurs */
  onRetry?: (attempt: number, bytesReceived: number) => void;
  /** Callback when total size is known (from Content-Length or Content-Range) */
  onTotalSize?: (totalSize: number) => void;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Creates a ReadableStream that automatically retries/resumes on connection errors.
 * The server must support HTTP Range requests (Accept-Ranges: bytes).
 */
export function createResilientStream(url: string, options: ResilientFetchOptions = {}): ReadableStream<Uint8Array> {
  const { maxRetries = 10, retryDelay = 1000, signal, onRetry, onTotalSize } = options;

  let bytesReceived = 0;
  let totalSize: number | null = null;
  let totalSizeReported = false;
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let retryCount = 0;
  let aborted = false;

  signal?.addEventListener('abort', () => {
    aborted = true;
    currentReader?.cancel().catch(() => {});
  });

  async function tryConnect(): Promise<boolean> {
    try {
      const headers: HeadersInit = {};
      if (bytesReceived > 0) headers['Range'] = `bytes=${bytesReceived}-`;

      const response = await fetch(url, { headers, signal });

      if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      // Get total size from first response
      if (totalSize === null) {
        const contentRange = response.headers.get('Content-Range');
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)$/);
          if (match) totalSize = parseInt(match[1], 10);
        } else {
          const contentLength = response.headers.get('Content-Length');
          if (contentLength) totalSize = parseInt(contentLength, 10);
        }

        // Report total size once
        if (totalSize !== null && !totalSizeReported) {
          totalSizeReported = true;
          onTotalSize?.(totalSize);
        }
      }

      if (!response.body) throw new Error('Response has no body');

      currentReader = response.body.getReader();
      retryCount = 0; // Reset retry count on successful connection
      return true;
    } catch (err) {
      if (aborted || signal?.aborted) return false;

      retryCount++;
      if (retryCount > maxRetries) throw new Error(`Failed after ${maxRetries} retries: ${err}`);

      onRetry?.(retryCount, bytesReceived);

      // Exponential backoff with jitter
      const delay = retryDelay * Math.pow(1.5, retryCount - 1) + Math.random() * 500;
      await sleep(delay);
      return false;
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Main pull loop - keeps trying until we get data, complete, or exhaust retries
      while (true) {
        if (aborted || signal?.aborted) {
          controller.close();
          return;
        }

        // Connect if needed
        if (!currentReader) {
          try {
            const connected = await tryConnect();
            if (!connected) continue; // Retry connection
          } catch (err) {
            controller.error(err);
            return;
          }
        }

        // Read from current connection
        try {
          const { done, value } = await currentReader!.read();

          if (done) {
            // Check if we got all the data
            if (totalSize !== null && bytesReceived < totalSize) {
              // Connection closed prematurely, retry
              currentReader = null;
              retryCount++;
              if (retryCount <= maxRetries) {
                onRetry?.(retryCount, bytesReceived);
                const delay = retryDelay * Math.pow(1.5, retryCount - 1) + Math.random() * 500;
                await sleep(delay);
                continue; // Retry in the loop
              }
            }
            controller.close();
            return;
          }

          if (value) {
            bytesReceived += value.byteLength;
            controller.enqueue(value);
            return; // Successfully delivered a chunk
          }
        } catch (err) {
          if (aborted || signal?.aborted) {
            controller.close();
            return;
          }

          // Connection error, try to resume
          currentReader = null;
          retryCount++;

          if (retryCount <= maxRetries) {
            onRetry?.(retryCount, bytesReceived);
            const delay = retryDelay * Math.pow(1.5, retryCount - 1) + Math.random() * 500;
            await sleep(delay);
            continue; // Retry in the loop
          }

          controller.error(new Error(`Connection lost after ${bytesReceived} bytes, retries exhausted: ${err}`));
          return;
        }
      }
    },

    cancel() {
      aborted = true;
      currentReader?.cancel().catch(() => {});
    }
  });
}
