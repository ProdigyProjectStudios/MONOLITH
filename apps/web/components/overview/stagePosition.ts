// The field and its accessible overlay share the same reading order.
export function stagePosition(index: number, narrow: boolean) {
  const columns = narrow ? 2 : 3;
  const row = Math.floor(index / columns);
  const column = row % 2 ? columns - 1 - (index % columns) : index % columns;
  return {
    x: narrow ? 0.26 + column * 0.48 : 0.18 + column * 0.32,
    y: narrow
      ? 0.15 + row * 0.32
      : 0.24 + row * 0.47 + (column === 1 ? -0.045 : 0),
  };
}
