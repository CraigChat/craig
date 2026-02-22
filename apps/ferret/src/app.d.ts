// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
import type { PlausibleTrackEvent, Recording } from '@craig/types';

import type { MinimalRecordingInfo } from '$lib/types';

declare global {
  namespace App {
    // interface Error {}
    interface Error {
      message?: string;
      error?: string;
      code?: string;
      deletedAt?: number;
    }
    // interface Locals {}
    interface PageData {
      recording?: MinimalRecordingInfo;
      users?: Recording.RecordingUser[];
      key?: string;
      deleteKey?: string;
      duration?: number | null;
    }
    // interface Platform {}
  }

  interface Window {
    plausible: PlausibleTrackEvent;
  }
}

export {};
