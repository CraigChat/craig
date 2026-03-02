import { basename } from 'node:path';
import fs from 'node:fs/promises';

import { TranscriptionProvider } from './provider';

export class OpenAIWhisperProvider implements TranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async transcribe(filePath: string, model: string): Promise<string> {
    const audio = await fs.readFile(filePath);
    const form = new (globalThis as any).FormData();
    form.set('model', model);
    form.set('response_format', 'text');
    form.set('file', new (globalThis as any).Blob([audio], { type: 'audio/flac' }), basename(filePath));

    const response = await (globalThis as any).fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: form
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`openai_http_${response.status}:${text.slice(0, 300)}`);
    return text.trim();
  }
}
