import type { SpriteSpec } from "./membrane";
import type { Node, Scene } from "./scene";

type Sprite = ImageBitmap | HTMLCanvasElement;
type Consumer = { specs: SpriteSpec[]; notify: () => void };
const limit = 48;
const cache = new Map<string, Sprite>();
const consumers = new Set<Consumer>();
const failed = new Set<string>();
let worker: Worker | undefined,
  busy: SpriteSpec | undefined,
  fallbackMode = false,
  idleTimer = 0;
let cancelCooperative: (() => void) | undefined;

export function spriteSpec(
  node: Node,
  count: number,
  layer: number,
): SpriteSpec {
  const quality = count <= 12 ? 2 : count < 35 ? 1 : 0;
  const id = quality === 0 ? "batch-" + (layer % 6) : node.key;
  const pressure = node.tone === "pressure";
  return {
    key: JSON.stringify([id, node.colour, quality, node.foldBand, pressure]),
    id,
    colour: node.colour,
    quality,
    foldBand: node.foldBand,
    pressure,
  };
}
export function cachedSprite(spec: SpriteSpec) {
  return cache.get(spec.key);
}
export function spriteMode() {
  return fallbackMode ? "cooperative" : "worker";
}
function requested() {
  const keys = new Map<string, SpriteSpec>();
  // Round-robin across visible fields. Both the queue and resident rasters
  // are bounded even on a workspace with hundreds of records.
  const requests = Array.from(consumers);
  const longest = Math.max(0, ...requests.map((c) => c.specs.length));
  for (let i = 0; i < longest && keys.size < limit; i++)
    for (const c of requests) {
      const s = c.specs[i];
      if (s && !keys.has(s.key)) keys.set(s.key, s);
      if (keys.size === limit) break;
    }
  return keys;
}
function release(sprite?: Sprite) {
  if (sprite && "close" in sprite) sprite.close();
}
function finish(key: string, sprite?: Sprite) {
  if (busy?.key !== key) {
    release(sprite);
    return;
  }
  busy = undefined;
  cancelCooperative = undefined;
  const wanted = requested();
  if (sprite) {
    if (wanted.has(key)) {
      if (cache.size >= limit) {
        const stale = Array.from(cache.keys()).find((k) => !wanted.has(k));
        if (stale) {
          release(cache.get(stale));
          cache.delete(stale);
        }
      }
      cache.set(key, sprite);
      for (const c of consumers)
        if (c.specs.some((s) => s.key === key)) c.notify();
    } else release(sprite);
  } else {
    if (failed.size >= limit) failed.clear();
    failed.add(key);
  }
  pump();
}
async function cooperative(spec: SpriteSpec) {
  // This path also covers browsers where worker-side OffscreenCanvas exists
  // but the 2D backend or transferable bitmap operation is restricted.
  try {
    const { rasterize } = await import("./membrane");
    if (busy !== spec) return;
    const canvas = document.createElement("canvas"),
      task = rasterize(canvas, spec);
    let raf = 0;
    const slice = () => {
      if (busy !== spec) return;
      if (!requested().has(spec.key)) {
        busy = undefined;
        cancelCooperative = undefined;
        pump();
        return;
      }
      try {
        const until = performance.now() + 5;
        do {
          if (task.next().done) {
            finish(spec.key, canvas);
            return;
          }
        } while (performance.now() < until);
        raf = requestAnimationFrame(slice);
      } catch {
        finish(spec.key);
      }
    };
    cancelCooperative = () => cancelAnimationFrame(raf);
    raf = requestAnimationFrame(slice);
  } catch {
    if (busy === spec) finish(spec.key);
  }
}
function useFallback() {
  worker?.terminate();
  worker = undefined;
  fallbackMode = true;
  if (busy) void cooperative(busy);
}
function pump() {
  if (busy) return;
  const next = Array.from(requested().values()).find(
    (s) => !cache.has(s.key) && !failed.has(s.key),
  );
  if (!next) return;
  busy = next;
  if (fallbackMode) {
    void cooperative(next);
    return;
  }
  try {
    if (
      typeof Worker === "undefined" ||
      typeof OffscreenCanvas === "undefined"
    ) {
      useFallback();
      return;
    }
    if (!worker) {
      worker = new Worker(new URL("./membrane.worker.ts", import.meta.url), {
        type: "module",
        name: "monolith-field-sprites",
      });
      worker.onmessage = ({
        data,
      }: {
        data: { key: string; bitmap?: ImageBitmap };
      }) => {
        if (!data.bitmap) {
          useFallback();
          return;
        }
        finish(data.key, data.bitmap);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        useFallback();
      };
      worker.onmessageerror = useFallback;
    }
    worker.postMessage(next);
  } catch {
    useFallback();
  }
}
export function observeSprites(scene: Scene, notify: () => void) {
  window.clearTimeout(idleTimer);
  const ordered = scene.nodes.slice().sort((a, b) => a.y - b.y);
  const specs = ordered.map((node, i) => spriteSpec(node, ordered.length, i));
  const unique = Array.from(
    new Map(specs.map((s) => [s.key, s])).values(),
  ).slice(0, limit);
  const client = { specs: unique, notify };
  consumers.add(client);
  pump();
  return () => {
    consumers.delete(client);
    if (!consumers.size)
      idleTimer = window.setTimeout(() => {
        if (consumers.size) return;
        worker?.terminate();
        worker = undefined;
        cancelCooperative?.();
        cancelCooperative = undefined;
        busy = undefined;
      }, 0);
  };
}
