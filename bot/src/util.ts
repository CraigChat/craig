export function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function makeError(obj: any) {
  const err = new Error(obj.message);
  err.name = obj.name;
  err.stack = obj.stack;
  return err;
}

export function makePlainError(err: Error) {
  const obj: any = {};
  obj.name = err.name;
  obj.message = err.message;
  obj.stack = err.stack;
  return obj;
}
