import type { ReliefMesh } from "./surface";

/** Project the cut planes onto display columns once per measurement change.
 * The transverse image stores each vertical span contiguously. This lets a
 * transition shade hundreds of visible contours in one canvas upload.
 */
export type ReliefProfile = {
  width: number;
  rows: number;
  top: Float32Array;
  pigment: Uint32Array;
  edge: Uint32Array;
};
const rgb = (r: number, g: number, b: number) =>
  (255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
function blend(a: number, b: number, t: number) {
  const r = a & 255,
    g = (a >>> 8) & 255,
    blue = (a >>> 16) & 255;
  return rgb(
    r + ((b & 255) - r) * t,
    g + (((b >>> 8) & 255) - g) * t,
    blue + (((b >>> 16) & 255) - blue) * t,
  );
}
function cover(bg: number, front: number, fraction: number) {
  const backAlpha = (bg >>> 24) / 255;
  const alpha = fraction + backAlpha * (1 - fraction);
  const color = blend(bg, front, fraction / (alpha || 1));
  return (color & 0x00ffffff) | ((alpha * 255) << 24);
}
function interpolateColor(colors: Uint8Array, at: number, t: number) {
  const r = colors[at],
    g = colors[at + 1],
    b = colors[at + 2];
  return rgb(
    r + (colors[at + 3] - r) * t,
    g + (colors[at + 4] - g) * t,
    b + (colors[at + 5] - b) * t,
  );
}

export function projectSections(
  mesh: ReliefMesh,
  width: number,
): ReliefProfile {
  const rows = mesh.slices.length,
    length = width * rows;
  const top = new Float32Array(length),
    pigment = new Uint32Array(length),
    edge = new Uint32Array(length);
  for (let row = 0; row < rows; row++) {
    const slice = mesh.slices[row];
    let segment = 0;
    for (let col = 0; col < width; col++) {
      const x = (col + 0.5) / width;
      while (segment < mesh.columns - 2 && slice.x[segment + 1] < x) segment++;
      const t = Math.min(
        1,
        Math.max(
          0,
          (x - slice.x[segment]) / (slice.x[segment + 1] - slice.x[segment]),
        ),
      );
      const at = col * rows + row;
      top[at] =
        slice.y[segment] + (slice.y[segment + 1] - slice.y[segment]) * t;
      pigment[at] = interpolateColor(slice.pigment, 3 * segment, t);
      edge[at] = interpolateColor(slice.edge, 3 * segment, t);
    }
  }
  return { width, rows, top, pigment, edge };
}

export function intermediate(
  a: ReliefProfile,
  b: ReliefProfile,
  t: number,
): ReliefProfile {
  if (t >= 1) return b;
  return {
    ...b,
    top: b.top.map((to, i) => a.top[i] + t * (to - a.top[i])),
    pigment: b.pigment.map((to, i) => blend(a.pigment[i], to, t)),
    edge: b.edge.map((to, i) => blend(a.edge[i], to, t)),
  };
}

export function createReliefPainter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  density: number,
) {
  const buffer = document.createElement("canvas");
  buffer.width = height;
  buffer.height = width;
  const graphics = buffer.getContext("2d");
  if (!graphics) return null;
  const image = graphics.createImageData(height, width);
  const pixels = new Uint32Array(image.data.buffer);
  const shadowSize = Math.max(4, Math.round(height * 0.06));
  const shadow = new Uint32Array(shadowSize);
  for (let i = 0; i < shadow.length; i++) {
    const distance = i / shadowSize;
    const alpha = Math.round(
      75 * Math.exp(-4 * distance ** 1.45) * (1 - distance),
    );
    shadow[i] = (alpha << 24) | 0x0023292e;
  }
  return (target: ReliefProfile, before?: ReliefProfile, fraction = 1) => {
    pixels.fill(0);
    const tween =
      before &&
      fraction < 1 &&
      before.rows === target.rows &&
      before.width === width
        ? before
        : undefined;
    const { rows } = target;
    for (let x = 0; x < width; x++) {
      const column = x * rows,
        offset = x * height;
      let bottom = 0;
      for (let row = 0; row < rows; row++) {
        const at = column + row;
        const position = tween
          ? tween.top[at] + (target.top[at] - tween.top[at]) * fraction
          : target.top[at];
        const y = position * height;
        const first = Math.floor(y);
        const skirt = (0.017 + 0.051 * (1 - row / (rows - 1))) * height;
        const end = Math.min(height, Math.ceil(y + skirt));
        bottom = Math.max(bottom, end);
        if (end <= 0 || first >= height) continue;
        const wash = tween
          ? blend(tween.pigment[at], target.pigment[at], fraction)
          : target.pigment[at];
        const edge = tween
          ? blend(tween.edge[at], target.edge[at], fraction)
          : target.edge[at];
        pixels.fill(wash, offset + Math.max(0, first + 1), offset + end);
        const uncovered = y - first;
        const next = x < width - 1 ? at + rows : at - rows;
        const neighbour = tween
          ? tween.top[next] + (target.top[next] - tween.top[next]) * fraction
          : target.top[next];
        const slope = Math.abs(neighbour - position) * height;
        // Integrate the rim across each pixel even on steep mobile flanks.
        const hairline = Math.min(
          3.4,
          density *
            (row % 7 === 0 ? 0.85 : 0.64) *
            Math.sqrt(1 + slope * slope),
        );
        if (first >= 0) {
          const top = offset + first;
          pixels[top] = cover(
            pixels[top],
            blend(wash, edge, Math.min(1, hairline)),
            1 - uncovered,
          );
        }
        const rimEnd = Math.min(end, Math.ceil(y + hairline));
        for (let py = Math.max(0, first + 1); py < rimEnd; py++) {
          pixels[offset + py] = blend(
            wash,
            edge,
            Math.min(1, y + hairline - py),
          );
        }
      }
      if (bottom > 0 && bottom < height)
        pixels.set(
          shadow.subarray(0, Math.min(shadowSize, height - bottom)),
          offset + bottom,
        );
    }
    graphics.putImageData(image, 0, 0);
    // The write buffer's columns are transposed. Rotate back on upload.
    ctx.setTransform(
      0,
      ctx.canvas.height / height,
      ctx.canvas.width / width,
      0,
      0,
      0,
    );
    ctx.clearRect(0, 0, height, width);
    ctx.drawImage(buffer, 0, 0);
  };
}
