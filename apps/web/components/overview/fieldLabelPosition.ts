/** Place system labels on the outside edge of the projected field. */
export function fieldLabelPosition(
  a: { x: number; y: number; rx: number; ry: number },
  width: number,
  height: number,
) {
  const x =
    a.x < width * 0.35
      ? a.x - a.rx * 0.9
      : a.x > width * 0.65
        ? a.x + a.rx * 0.15
        : a.x - a.rx * 0.2;
  const y =
    a.y > height * 0.62 ? a.y + a.ry * 1.12 + 6 : a.y - a.ry * 1.22 - 44;
  return {
    left: Math.max(8, Math.min(x, width - 150)),
    top: Math.max(6, Math.min(y, height - 46)),
  };
}
