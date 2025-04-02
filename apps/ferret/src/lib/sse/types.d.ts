import type { MinimalJobInfo, MinimalJobUpdate } from '$lib/types';

export interface MessageEvent {
  id?: string;
  event?: string;
  data?: string | object;
  retry?: number;
}

export interface InitMessageEvent extends MessageEvent {
  event: 'init';
  data:
    | {
        id: string;
        streaming: true;
      }
    | {
        streaming: false;
        job: MinimalJobInfo;
      };
}

export interface PingMessageEvent extends MessageEvent {
  event: 'ping';
  data: {
    t: number;
  };
}

export interface UpdateMessageEvent extends MessageEvent {
  event: 'update';
  data: {
    update?: MinimalJobUpdate;
    job?: MinimalJobInfo;
  };
}

export interface EndMessageEvent extends MessageEvent {
  event: 'end';
  data?: {
    error?: string;
  };
}

export type AnyMessageEvent = InitMessageEvent | PingMessageEvent | UpdateMessageEvent | EndMessageEvent;
