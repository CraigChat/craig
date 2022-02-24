export interface ManagerRequestMessage<T = any> {
  t: string;
  n: string;
  d: T;
}

export interface ManagerResponseMessage<T = any> {
  r: string;
  d: T;
}

export interface ShardEvalResponse {
  result: any;
  error: any;
}
