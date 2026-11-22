type WorkerEvent = {
  kind: string;
  stage: string;
  payload: Record<string, unknown>;
};
let worker: Worker | undefined;
let serial = 0;
export function runtimeTask<T>(
  task: string,
  args: Record<string, unknown>,
  event?: (payload: WorkerEvent) => void,
): Promise<T> {
  worker ??= new Worker("/runtime-worker.js", { type: "module" });
  const instance = worker,
    id = ++serial;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      instance.removeEventListener("message", message);
      instance.removeEventListener("error", failed);
    };
    const failed = () => {
      cleanup();
      instance.terminate();
      if (worker === instance) worker = undefined;
      reject(
        new Error("The local analysis worker stopped. Retry the operation."),
      );
    };
    const message = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      if (e.data.event) {
        event?.(e.data.event);
        return;
      }
      cleanup();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.value as T);
    };
    instance.addEventListener("message", message);
    instance.addEventListener("error", failed);
    instance.postMessage({ id, task, ...args });
  });
}
