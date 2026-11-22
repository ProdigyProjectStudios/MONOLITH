import { rasterize, type SpriteSpec } from "./membrane";

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<SpriteSpec>) => void) | null;
  postMessage: (
    message: { key: string; bitmap?: ImageBitmap },
    transfer?: Transferable[],
  ) => void;
};
worker.onmessage = ({ data }) => {
  try {
    const canvas = new OffscreenCanvas(1, 1);
    for (const progress of rasterize(canvas, data)) void progress;
    const bitmap = canvas.transferToImageBitmap();
    worker.postMessage({ key: data.key, bitmap }, [bitmap]);
  } catch {
    worker.postMessage({ key: data.key });
  }
};
