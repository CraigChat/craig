import * as Kitchen from './kitchen';
import * as Recording from './recording';

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

type PlausibleCallbackArgs = {
  readonly status: number;
};

export type PlausibleEventOptions = {
  readonly u?: string;
  readonly callback?: (args: PlausibleCallbackArgs) => void;
  readonly props?: { readonly [propName: string]: string | number | boolean };
};

export type PlausibleTrackEvent = ((eventName: string, options?: PlausibleEventOptions, eventData?: PlausibleOptions) => void) & { q?: any[] };

export { Kitchen, Recording };
