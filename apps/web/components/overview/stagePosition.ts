// The field and its accessible overlay share the same reading order.
export function stagePosition(index: number, narrow: boolean) {
  const columns = narrow ? 2 : 3;
  const row = Math.floor(index / columns);
  const column = row % 2 ? columns - 1 - (index % columns) : index % columns;
  return {
    x: narrow ? 0.26 + column * 0.48 : 0.18 + column * 0.32,
    y: narrow
      ? 0.17 + row * 0.31
      : 0.265 + row * 0.44 + (column === 1 ? -0.025 : 0),
  };
}
