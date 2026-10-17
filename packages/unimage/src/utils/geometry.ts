import type { ImagePosition } from "../types";
import type { RgbaImage } from "./filters";

export type FocusMode = "entropy" | "attention";

/** Resolve the top-left origin for a scaled image within its excess space. */
export function alignedOrigin(
  position: ImagePosition | undefined,
  excessWidth: number,
  excessHeight: number,
): [number, number] {
  const tokens = position === undefined ? [] : position.split(" ");
  const x = tokens.includes("left")
    ? 0
    : tokens.includes("right")
      ? excessWidth
      : Math.floor(excessWidth / 2);
  const y = tokens.includes("top")
    ? 0
    : tokens.includes("bottom")
      ? excessHeight
      : Math.floor(excessHeight / 2);
  return [x, y];
}

/** Find the center of the most visually significant 50%×50% region. */
export function focusPoint(image: RgbaImage, mode: FocusMode): [number, number] {
  const stride = Math.max(1, Math.ceil(Math.max(image.width, image.height) / 256));
  const smallWidth = Math.max(1, Math.floor(image.width / stride));
  const smallHeight = Math.max(1, Math.floor(image.height / stride));
  const scores = new Float64Array(smallWidth * smallHeight);
  const lumaAt = (x: number, y: number): number => {
    const index =
      (Math.max(0, Math.min(image.height - 1, y)) * image.width +
        Math.max(0, Math.min(image.width - 1, x))) *
      4;
    return (
      0.299 * image.data[index]! + 0.587 * image.data[index + 1]! + 0.114 * image.data[index + 2]!
    );
  };

  for (let y = 0; y < smallHeight; y += 1) {
    for (let x = 0; x < smallWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, x * stride);
      const sourceY = Math.min(image.height - 1, y * stride);
      if (mode === "attention") {
        const left = lumaAt(sourceX - stride, sourceY);
        const right = lumaAt(sourceX + stride, sourceY);
        const up = lumaAt(sourceX, sourceY - stride);
        const down = lumaAt(sourceX, sourceY + stride);
        scores[y * smallWidth + x] = Math.abs(right - left) + Math.abs(down - up);
      } else {
        const histogram = new Map<number, number>();
        const radius = 4;
        let total = 0;
        for (let offsetY = -radius; offsetY <= radius; offsetY += radius) {
          for (let offsetX = -radius; offsetX <= radius; offsetX += radius) {
            const value = Math.round(
              lumaAt(sourceX + offsetX * stride, sourceY + offsetY * stride),
            );
            histogram.set(value, (histogram.get(value) ?? 0) + 1);
            total += 1;
          }
        }
        let entropy = 0;
        for (const count of histogram.values()) {
          const probability = count / total;
          entropy -= probability * Math.log2(probability);
        }
        scores[y * smallWidth + x] = entropy;
      }
    }
  }

  const windowWidth = Math.max(1, Math.floor(smallWidth * 0.5));
  const windowHeight = Math.max(1, Math.floor(smallHeight * 0.5));
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestX = smallWidth / 2;
  let bestY = smallHeight / 2;
  for (let y = 0; y + windowHeight <= smallHeight; y += 1) {
    for (let x = 0; x + windowWidth <= smallWidth; x += 1) {
      let total = 0;
      for (let offsetY = 0; offsetY < windowHeight; offsetY += 1) {
        for (let offsetX = 0; offsetX < windowWidth; offsetX += 1) {
          total += scores[(y + offsetY) * smallWidth + x + offsetX]!;
        }
      }
      if (total > bestScore) {
        bestScore = total;
        bestX = x + windowWidth / 2;
        bestY = y + windowHeight / 2;
      }
    }
  }
  return [bestX / smallWidth, bestY / smallHeight];
}
