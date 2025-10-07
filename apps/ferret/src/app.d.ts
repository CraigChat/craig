// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
import type { Recording } from '@craig/types';

import type { MinimalRecordingInfo } from '$lib/types';
import type { PlausibleTrackEvent } from '@craig/types';
declare global {
  namespace App {
    // interface Error {}
    interface Error {
      message?: string;
      error?: string;
      code?: string;
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
