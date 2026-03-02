export interface TranscriptionProvider {
  transcribe(filePath: string, model: string): Promise<string>;
}

