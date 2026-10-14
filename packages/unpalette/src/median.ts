import { toHex } from "./color";
import type { Palette, PaletteColor, RGB } from "./types";

interface Bucket {
  pixels: RGB[];
}

function channelRange(pixels: RGB[], channel: "r" | "g" | "b"): number {
  let min = 255;
  let max = 0;
  for (const pixel of pixels) {
    const value = pixel[channel];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

/**
 * Median-cut palette extraction: repeatedly split the bucket whose widest
 * channel has the largest range at its median, then average each bucket.
 */
export function cut(pixels: RGB[], colors: number): Palette {
  let buckets: Bucket[] = [{ pixels }];
  while (buckets.length < colors) {
    let splitIndex = -1;
    let splitChannel: "r" | "g" | "b" = "r";
    let widest = 0;
    for (const [index, bucket] of buckets.entries()) {
      if (bucket.pixels.length < 2) continue;
      for (const channel of ["r", "g", "b"] as const) {
        const range = channelRange(bucket.pixels, channel);
        if (range > widest) {
          widest = range;
          splitIndex = index;
          splitChannel = channel;
        }
      }
    }
    if (splitIndex === -1) break;

    const bucket = buckets[splitIndex]!;
    bucket.pixels.sort((left, right) => left[splitChannel] - right[splitChannel]);
    // Split at the largest gap instead of the median so a cut never lands
    // inside a tight color cluster.
    let splitAt = bucket.pixels.length >> 1;
    let largestGap = 0;
    for (let index = 1; index < bucket.pixels.length; index += 1) {
      const gap = bucket.pixels[index]![splitChannel] - bucket.pixels[index - 1]![splitChannel];
      if (gap > largestGap) {
        largestGap = gap;
        splitAt = index;
      }
    }
    buckets = [
      ...buckets.slice(0, splitIndex),
      { pixels: bucket.pixels.slice(0, splitAt) },
      { pixels: bucket.pixels.slice(splitAt) },
      ...buckets.slice(splitIndex + 1),
    ];
  }

  const paletteColors: PaletteColor[] = buckets
    .filter((bucket) => bucket.pixels.length > 0)
    .map((bucket) => {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const pixel of bucket.pixels) {
        red += pixel.r;
        green += pixel.g;
        blue += pixel.b;
      }
      const color: RGB = {
        r: Math.round(red / bucket.pixels.length),
        g: Math.round(green / bucket.pixels.length),
        b: Math.round(blue / bucket.pixels.length),
      };
      return {
        color,
        hex: toHex(color),
        ratio: bucket.pixels.length / pixels.length,
      };
    })
    .sort((left, right) => right.ratio - left.ratio);

  return { colors: paletteColors, sampled: pixels.length };
}
