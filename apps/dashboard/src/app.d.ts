// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
import type { APIUser } from 'discord-api-types/v10';
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
      auth?: {
        user: APIUser;
      };
      data?: {
        rewardTier?: number;
      };
    }
    // interface Platform {}
  }

  interface Window {
    plausible: PlausibleTrackEvent;
  }
}

export {};
