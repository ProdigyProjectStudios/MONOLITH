// Pressure is the local median wait relative to the longest wait on the path.
// The wave and the fibre fold both range from -1 to 1. Reserve headroom even
// when all three reach their extremes together.
export function ribbonSection(height: number, pressure: number, wave: number) {
  return {
    middle: height * (0.53 - 0.035 * pressure + 0.025 * wave),
    spread: height * (0.075 + 0.265 * pressure),
  };
}
