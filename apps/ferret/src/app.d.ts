// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
import type { Recording } from '@craig/types';

import type { MinimalRecordingInfo } from '$lib/types';

type PlausibleInitOptions = {
  readonly hashMode?: boolean;
  readonly trackLocalhost?: boolean;
  readonly domain?: Location['hostname'];
  readonly apiHost?: string;
};

type PlausibleEventData = {
  readonly url?: Location['href'];
  readonly referrer?: Document['referrer'] | null;
  readonly deviceWidth?: Window['innerWidth'];
};

type PlausibleOptions = PlausibleInitOptions & PlausibleEventData;

type CallbackArgs = {
  readonly status: number;
};

export type EventOptions = {
  readonly u?: string;
  readonly callback?: (args: CallbackArgs) => void;
  readonly props?: { readonly [propName: string]: string | number | boolean };
};

type TrackEvent = ((eventName: string, options?: EventOptions, eventData?: PlausibleOptions) => void) & { q?: any[] };

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
    plausible: TrackEvent;
  }
}

export {};
