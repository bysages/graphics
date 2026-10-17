import { hslToRgb, parseRgba, rgbToHsl } from "unpalette";

export interface RgbaImage {
  data: Uint8Array;
  width: number;
  height: number;
}

type Rgba = readonly [number, number, number, number];

const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

export function parseColor(value: string | undefined): Rgba {
  if (value === undefined || value === "") return [0, 0, 0, 0];
  const rgba = parseRgba(value);
  return [rgba.r, rgba.g, rgba.b, Math.round(rgba.a * 255)];
}

function createImage(width: number, height: number, background: Rgba = [0, 0, 0, 0]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = background[0];
    data[index + 1] = background[1];
    data[index + 2] = background[2];
    data[index + 3] = background[3];
  }
  return { data, width, height };
}

function cloneImage(image: RgbaImage): RgbaImage {
  return { data: image.data.slice(), width: image.width, height: image.height };
}

function pixelIndex(image: RgbaImage, x: number, y: number): number {
  return (y * image.width + x) * 4;
}

function channels(input: Uint8Array, index: number): [number, number, number] {
  return [input[index] as number, input[index + 1] as number, input[index + 2] as number];
}

function medianImage(image: RgbaImage, size: number): RgbaImage {
  const output = cloneImage(image);
  const radius = Math.floor(size / 2);
  const values: number[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        values.length = 0;
        for (let row = -radius; row <= radius; row += 1) {
          for (let column = -radius; column <= radius; column += 1) {
            const sampleY = Math.max(0, Math.min(image.height - 1, y + row));
            const sampleX = Math.max(0, Math.min(image.width - 1, x + column));
            values.push(image.data[pixelIndex(image, sampleX, sampleY) + channel] as number);
          }
        }
        values.sort((left, right) => left - right);
        output.data[pixelIndex(output, x, y) + channel] = values[
          Math.floor(values.length / 2)
        ] as number;
      }
    }
  }
  return output;
}

function morphology(image: RgbaImage, size: number, mode: "dilate" | "erode"): RgbaImage {
  const output = cloneImage(image);
  const radius = Math.floor(size / 2);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = mode === "dilate" ? 0 : 255;
        for (let row = -radius; row <= radius; row += 1) {
          for (let column = -radius; column <= radius; column += 1) {
            const sampleY = Math.max(0, Math.min(image.height - 1, y + row));
            const sampleX = Math.max(0, Math.min(image.width - 1, x + column));
            const sample = image.data[pixelIndex(image, sampleX, sampleY) + channel] as number;
            value = mode === "dilate" ? Math.max(value, sample) : Math.min(value, sample);
          }
        }
        output.data[pixelIndex(output, x, y) + channel] = value;
      }
    }
  }
  return output;
}

function luma(red: number, green: number, blue: number): number {
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function sharpenImage(
  image: RgbaImage,
  operation: { sigma?: number; flat?: number; jagged?: number },
): RgbaImage {
  const sigma = Math.max(0.1, operation.sigma ?? 1);
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }
  for (let index = 0; index < kernel.length; index += 1)
    kernel[index] = (kernel[index] as number) / sum;

  const blurred = cloneImage(image);
  const horizontal = cloneImage(image);
  const width = image.width;
  const height = image.height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x + offset));
        const index = pixelIndex(image, sampleX, y);
        const weight = kernel[offset + radius] as number;
        red += (image.data[index] as number) * weight;
        green += (image.data[index + 1] as number) * weight;
        blue += (image.data[index + 2] as number) * weight;
      }
      const target = pixelIndex(horizontal, x, y);
      horizontal.data[target] = clamp255(red);
      horizontal.data[target + 1] = clamp255(green);
      horizontal.data[target + 2] = clamp255(blue);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offset));
        const index = pixelIndex(horizontal, x, sampleY);
        const weight = kernel[offset + radius] as number;
        red += (horizontal.data[index] as number) * weight;
        green += (horizontal.data[index + 1] as number) * weight;
        blue += (horizontal.data[index + 2] as number) * weight;
      }
      const target = pixelIndex(blurred, x, y);
      blurred.data[target] = clamp255(red);
      blurred.data[target + 1] = clamp255(green);
      blurred.data[target + 2] = clamp255(blue);
    }
  }

  const output = cloneImage(image);
  const flat = (operation.flat ?? 1) / 255;
  const jagged = (operation.jagged ?? 2) / 255;
  const amount = Math.max(0, Math.min(2, sigma / 2 + 0.5));
  for (let index = 0; index < output.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const original = output.data[index + channel] as number;
      const delta = original - (blurred.data[index + channel] as number);
      const magnitude = Math.abs(delta) / 255;
      if (magnitude <= flat) continue;
      const clamped = Math.max(-jagged, Math.min(jagged, delta / 255)) * 255;
      output.data[index + channel] = clamp255(original + clamped * amount);
    }
  }
  return output;
}

function claheImage(
  image: RgbaImage,
  operation: { width: number; height: number; maxSlope?: number },
): RgbaImage {
  const tileColumns = Math.max(1, Math.min(image.width, operation.width));
  const tileRows = Math.max(1, Math.min(image.height, operation.height));
  const tileWidth = Math.ceil(image.width / tileColumns);
  const tileHeight = Math.ceil(image.height / tileRows);
  const maxSlope = operation.maxSlope ?? 3;
  const bins = 256;

  const luts: Uint8Array[] = [];
  for (let row = 0; row < tileRows; row += 1) {
    for (let column = 0; column < tileColumns; column += 1) {
      const histogram = new Uint32Array(bins);
      const yStart = row * tileHeight;
      const yEnd = Math.min(image.height, yStart + tileHeight);
      const xStart = column * tileWidth;
      const xEnd = Math.min(image.width, xStart + tileWidth);
      let total = 0;
      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const index = pixelIndex(image, x, y);
          if ((image.data[index + 3] as number) === 0) continue;
          const value = Math.round(
            luma(
              image.data[index] as number,
              image.data[index + 1] as number,
              image.data[index + 2] as number,
            ),
          );
          const bin = Math.max(0, Math.min(255, value));
          histogram[bin] = (histogram[bin] ?? 0) + 1;
          total += 1;
        }
      }
      if (total === 0) {
        luts.push(new Uint8Array(bins).map((_, value) => value));
        continue;
      }
      const clipLimit = Math.max(1, Math.floor((maxSlope * total) / bins));
      let excess = 0;
      for (let value = 0; value < bins; value += 1) {
        if ((histogram[value] as number) > clipLimit) {
          excess += (histogram[value] as number) - clipLimit;
          histogram[value] = clipLimit;
        }
      }
      const redistribution = Math.floor(excess / bins);
      for (let value = 0; value < bins; value += 1)
        histogram[value] = (histogram[value] as number) + redistribution;
      const lut = new Uint8Array(bins);
      let cumulative = 0;
      for (let value = 0; value < bins; value += 1) {
        cumulative += histogram[value] as number;
        lut[value] = clamp255((cumulative / total) * 255);
      }
      luts.push(lut);
    }
  }

  const output = cloneImage(image);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = pixelIndex(image, x, y);
      const red = image.data[index] as number;
      const green = image.data[index + 1] as number;
      const blue = image.data[index + 2] as number;
      const value = luma(red, green, blue);
      const column = Math.min(tileColumns - 1, Math.floor(x / tileWidth));
      const row = Math.min(tileRows - 1, Math.floor(y / tileHeight));
      const lut = luts[row * tileColumns + column] as Uint8Array;
      const mapped = lut[Math.max(0, Math.min(255, Math.round(value)))] as number;
      if (value <= 0) continue;
      const gain = mapped / value;
      output.data[index] = clamp255(red * gain);
      output.data[index + 1] = clamp255(green * gain);
      output.data[index + 2] = clamp255(blue * gain);
    }
  }
  return output;
}

export function applyPixelFilter(
  image: RgbaImage,
  operation: Extract<
    import("../types").ImageOperation,
    {
      type:
        | "trim"
        | "extend"
        | "sharpen"
        | "median"
        | "dilate"
        | "erode"
        | "clahe"
        | "flatten"
        | "unflatten"
        | "gamma"
        | "normalize"
        | "threshold"
        | "linear"
        | "modulate"
        | "opacity"
        | "tint"
        | "contrast"
        | "convolve"
        | "colorMatrix"
        | "posterize"
        | "pixelate"
        | "removeAlpha"
        | "ensureAlpha";
    }
  >,
): RgbaImage {
  switch (operation.type) {
    case "trim": {
      const threshold = operation.threshold ?? 10;
      const reference = channels(image.data, 0);
      const referenceAlpha = image.data[3] ?? 0;
      let top = 0;
      let bottom = image.height - 1;
      let left = 0;
      let right = image.width - 1;
      const differs = (index: number): boolean => {
        return (
          Math.abs((image.data[index] as number) - reference[0]) > threshold ||
          Math.abs((image.data[index + 1] as number) - reference[1]) > threshold ||
          Math.abs((image.data[index + 2] as number) - reference[2]) > threshold ||
          Math.abs((image.data[index + 3] as number) - referenceAlpha) > threshold
        );
      };
      while (
        top < bottom &&
        ![...Array(image.width).keys()].some((x) => differs(pixelIndex(image, x, top)))
      )
        top += 1;
      while (
        bottom > top &&
        ![...Array(image.width).keys()].some((x) => differs(pixelIndex(image, x, bottom)))
      )
        bottom -= 1;
      while (
        left < right &&
        ![...Array(image.height).keys()].some((y) => differs(pixelIndex(image, left, y)))
      )
        left += 1;
      while (
        right > left &&
        ![...Array(image.height).keys()].some((y) => differs(pixelIndex(image, right, y)))
      )
        right -= 1;
      const width = right - left + 1;
      const height = bottom - top + 1;
      const output = createImage(width, height);
      for (let y = 0; y < height; y += 1) {
        output.data.set(
          image.data.subarray(
            pixelIndex(image, left, top + y),
            pixelIndex(image, left, top + y) + width * 4,
          ),
          y * width * 4,
        );
      }
      return output;
    }
    case "extend": {
      const mode = operation.extendWith ?? "background";
      const outputWidth = image.width + operation.left + operation.right;
      const outputHeight = image.height + operation.top + operation.bottom;
      const output = createImage(
        outputWidth,
        outputHeight,
        mode === "background" ? parseColor(operation.background) : [0, 0, 0, 0],
      );
      for (let y = 0; y < image.height; y += 1) {
        const source = pixelIndex(image, 0, y);
        const target = pixelIndex(output, operation.left, y + operation.top);
        output.data.set(image.data.subarray(source, source + image.width * 4), target);
      }
      if (mode === "copy") {
        for (let y = 0; y < outputHeight; y += 1) {
          const sourceY = Math.max(0, Math.min(image.height - 1, y - operation.top));
          for (let x = 0; x < outputWidth; x += 1) {
            const sourceX = Math.max(0, Math.min(image.width - 1, x - operation.left));
            const source = pixelIndex(image, sourceX, sourceY);
            const target = pixelIndex(output, x, y);
            output.data[target] = image.data[source] as number;
            output.data[target + 1] = image.data[source + 1] as number;
            output.data[target + 2] = image.data[source + 2] as number;
            output.data[target + 3] = image.data[source + 3] as number;
          }
        }
      } else if (mode === "repeat" || mode === "mirror") {
        for (let y = 0; y < outputHeight; y += 1) {
          for (let x = 0; x < outputWidth; x += 1) {
            const innerX = x - operation.left;
            const innerY = y - operation.top;
            if (innerX >= 0 && innerX < image.width && innerY >= 0 && innerY < image.height)
              continue;
            let sourceX: number;
            let sourceY: number;
            if (mode === "repeat") {
              sourceX = ((innerX % image.width) + image.width) % image.width;
              sourceY = ((innerY % image.height) + image.height) % image.height;
            } else {
              const periodX = image.width * 2;
              const periodY = image.height * 2;
              const foldedX = ((innerX % periodX) + periodX) % periodX;
              const foldedY = ((innerY % periodY) + periodY) % periodY;
              sourceX = foldedX < image.width ? foldedX : periodX - foldedX - 1;
              sourceY = foldedY < image.height ? foldedY : periodY - foldedY - 1;
            }
            const source = pixelIndex(image, sourceX, sourceY);
            const target = pixelIndex(output, x, y);
            output.data[target] = image.data[source] as number;
            output.data[target + 1] = image.data[source + 1] as number;
            output.data[target + 2] = image.data[source + 2] as number;
            output.data[target + 3] = image.data[source + 3] as number;
          }
        }
      }
      return output;
    }
    case "sharpen":
      return sharpenImage(image, operation);
    case "median":
      return medianImage(image, operation.size);
    case "dilate":
    case "erode":
      return morphology(image, operation.size, operation.type);
    case "clahe":
      return claheImage(image, operation);
    case "flatten": {
      const background = parseColor(operation.background ?? "#000000");
      const output = cloneImage(image);
      for (let index = 0; index < output.data.length; index += 4) {
        const alpha = (output.data[index + 3] as number) / 255;
        output.data[index] = clamp255(
          (output.data[index] as number) * alpha + background[0] * (1 - alpha),
        );
        output.data[index + 1] = clamp255(
          (output.data[index + 1] as number) * alpha + background[1] * (1 - alpha),
        );
        output.data[index + 2] = clamp255(
          (output.data[index + 2] as number) * alpha + background[2] * (1 - alpha),
        );
        output.data[index + 3] = 255;
      }
      return output;
    }
    case "unflatten": {
      const output = cloneImage(image);
      for (let index = 0; index < output.data.length; index += 4) {
        const alpha = output.data[index + 3] as number;
        if (alpha > 0) {
          output.data[index] = clamp255(((output.data[index] as number) * 255) / alpha);
          output.data[index + 1] = clamp255(((output.data[index + 1] as number) * 255) / alpha);
          output.data[index + 2] = clamp255(((output.data[index + 2] as number) * 255) / alpha);
        }
        output.data[index + 3] = 255;
      }
      return output;
    }
    case "gamma": {
      const output = cloneImage(image);
      const ratio = operation.gamma / (operation.gammaOut ?? operation.gamma);
      for (let index = 0; index < output.data.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const value = (output.data[index + channel] as number) / 255;
          output.data[index + channel] = clamp255(value ** ratio * 255);
        }
      }
      return output;
    }
    case "normalize": {
      const histogram = Array.from({ length: 256 }, () => 0);
      for (let index = 0; index < image.data.length; index += 4) {
        if ((image.data[index + 3] as number) > 0) {
          histogram[image.data[index] as number] =
            (histogram[image.data[index] as number] ?? 0) + 1;
          histogram[image.data[index + 1] as number] =
            (histogram[image.data[index + 1] as number] ?? 0) + 1;
          histogram[image.data[index + 2] as number] =
            (histogram[image.data[index + 2] as number] ?? 0) + 1;
        }
      }
      const total = histogram.reduce((sum, count) => sum + count, 0);
      const lowerTarget = total * ((operation.lower ?? 0) / 100);
      const upperTarget = total * ((operation.upper ?? 100) / 100);
      let cumulative = 0;
      let lower = 0;
      let upper = 255;
      for (let value = 0; value < 256; value += 1) {
        cumulative += histogram[value] ?? 0;
        if (cumulative <= lowerTarget) lower = value;
        if (cumulative < upperTarget) upper = value;
      }
      if (upper <= lower) return image;
      const output = cloneImage(image);
      for (let index = 0; index < output.data.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const value = output.data[index + channel] as number;
          output.data[index + channel] = clamp255(((value - lower) / (upper - lower)) * 255);
        }
      }
      return output;
    }
    case "threshold": {
      const output = cloneImage(image);
      for (let index = 0; index < output.data.length; index += 4) {
        if (operation.grayscale === true) {
          const luma =
            0.299 * (output.data[index] as number) +
            0.587 * (output.data[index + 1] as number) +
            0.114 * (output.data[index + 2] as number);
          const value = luma >= operation.value ? 255 : 0;
          output.data[index] = value;
          output.data[index + 1] = value;
          output.data[index + 2] = value;
        } else {
          for (let channel = 0; channel < 3; channel += 1) {
            output.data[index + channel] =
              (output.data[index + channel] as number) >= operation.value ? 255 : 0;
          }
        }
      }
      return output;
    }
    case "linear": {
      const multiplier = operation.a ?? 1;
      const offset = operation.b ?? 0;
      const output = cloneImage(image);
      for (let index = 0; index < output.data.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          output.data[index + channel] = clamp255(
            (output.data[index + channel] as number) * multiplier + offset,
          );
        }
      }
      return output;
    }
    case "modulate": {
      const output = cloneImage(image);
      for (let index = 0; index < output.data.length; index += 4) {
        let [red, green, blue] = channels(output.data, index);
        if (operation.brightness !== undefined) {
          red = clamp255(red * operation.brightness);
          green = clamp255(green * operation.brightness);
          blue = clamp255(blue * operation.brightness);
        }
        const original = rgbToHsl({ r: red, g: green, b: blue });
        const hue =
          operation.hue === undefined ? original.h : (original.h + operation.hue + 360) % 360;
        const saturation =
          operation.saturation === undefined
            ? original.s
            : Math.max(0, Math.min(1, original.s * operation.saturation));
        const lightness =
          operation.lightness === undefined
            ? original.l
            : Math.max(0, Math.min(1, original.l + operation.lightness / 100));
        const modulated = hslToRgb({ h: hue, s: saturation, l: lightness });
        output.data[index] = modulated.r;
        output.data[index + 1] = modulated.g;
        output.data[index + 2] = modulated.b;
      }
      return output;
    }
    case "contrast": {
      const amount = operation.amount / 100;
      const multiplier = 1 + amount;
      const offset = 128 * -amount;
      const output = cloneImage(image);
      for (let index = 0; index < output.data.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          output.data[index + channel] = clamp255(
            (output.data[index + channel] as number) * multiplier + offset,
          );
        }
      }
      return output;
    }
    case "convolve": {
      const output = createImage(image.width, image.height);
      const halfWidth = Math.floor(operation.width / 2);
      const halfHeight = Math.floor(operation.height / 2);
      const scale = operation.scale ?? operation.kernel.reduce((total, value) => total + value, 0);
      const offset = operation.offset ?? 0;
      const sample = (x: number, y: number, channel: number) => {
        if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
          return image.data[(y * image.width + x) * 4 + channel] ?? 0;
        }
        if (operation.border === "mirror") {
          const mirroredX = x < 0 ? -x - 1 : x >= image.width ? image.width * 2 - x - 1 : x;
          const mirroredY = y < 0 ? -y - 1 : y >= image.height ? image.height * 2 - y - 1 : y;
          return image.data[(mirroredY * image.width + mirroredX) * 4 + channel] ?? 0;
        }
        const clampedX = Math.max(0, Math.min(image.width - 1, x));
        const clampedY = Math.max(0, Math.min(image.height - 1, y));
        return image.data[(clampedY * image.width + clampedX) * 4 + channel] ?? 0;
      };
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          for (let channel = 0; channel < 3; channel += 1) {
            let total = 0;
            for (let kernelY = 0; kernelY < operation.height; kernelY += 1) {
              for (let kernelX = 0; kernelX < operation.width; kernelX += 1) {
                total +=
                  (operation.kernel[kernelY * operation.width + kernelX] ?? 0) *
                  sample(x + kernelX - halfWidth, y + kernelY - halfHeight, channel);
              }
            }
            const normalized = scale === 0 ? total : total / scale + offset;
            output.data[(y * image.width + x) * 4 + channel] = clamp255(normalized);
          }
          output.data[(y * image.width + x) * 4 + 3] =
            image.data[(y * image.width + x) * 4 + 3] ?? 255;
        }
      }
      return output;
    }
    case "colorMatrix": {
      const output = cloneImage(image);
      const matrix = operation.matrix;
      for (let index = 0; index < output.data.length; index += 4) {
        const red = (output.data[index] as number) / 255;
        const green = (output.data[index + 1] as number) / 255;
        const blue = (output.data[index + 2] as number) / 255;
        const alpha = (output.data[index + 3] as number) / 255;
        for (let row = 0; row < 4; row += 1) {
          const value =
            (matrix[row * 5] ?? 0) * red +
            (matrix[row * 5 + 1] ?? 0) * green +
            (matrix[row * 5 + 2] ?? 0) * blue +
            (matrix[row * 5 + 3] ?? 0) * alpha +
            (matrix[row * 5 + 4] ?? 0);
          output.data[index + row] = clamp255(value * 255);
        }
      }
      return output;
    }
    case "posterize": {
      const output = cloneImage(image);
      const step = 255 / (operation.levels - 1);
      const quantize = (value: number) => clamp255(Math.round(Math.round(value / step) * step));
      const channelCount = operation.alpha === true ? 4 : 3;
      for (let index = 0; index < output.data.length; index += 4) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          output.data[index + channel] = quantize(output.data[index + channel] as number);
        }
      }
      return output;
    }
    case "pixelate": {
      const output = cloneImage(image);
      const size = operation.size;
      for (let y = 0; y < image.height; y += size) {
        for (let x = 0; x < image.width; x += size) {
          const width = Math.min(size, image.width - x);
          const height = Math.min(size, image.height - y);
          let red = 0;
          let green = 0;
          let blue = 0;
          let alphaWeight = 0;
          for (let pixelY = y; pixelY < y + height; pixelY += 1) {
            for (let pixelX = x; pixelX < x + width; pixelX += 1) {
              const index = pixelIndex(image, pixelX, pixelY);
              const alpha = (image.data[index + 3] as number) / 255;
              red += (image.data[index] as number) * alpha;
              green += (image.data[index + 1] as number) * alpha;
              blue += (image.data[index + 2] as number) * alpha;
              alphaWeight += alpha;
            }
          }
          const alpha = clamp255((alphaWeight / (width * height)) * 255);
          const colorWeight = Math.max(alphaWeight, Number.EPSILON);
          const blockRed = clamp255(red / colorWeight);
          const blockGreen = clamp255(green / colorWeight);
          const blockBlue = clamp255(blue / colorWeight);
          const target = pixelIndex(output, x, y);
          output.data[target] = blockRed;
          output.data[target + 1] = blockGreen;
          output.data[target + 2] = blockBlue;
          output.data[target + 3] = alpha;
          for (let row = 0; row < height; row += 1) {
            for (let column = 0; column < width; column += 1) {
              const index = pixelIndex(output, x + column, y + row);
              output.data[index] = blockRed;
              output.data[index + 1] = blockGreen;
              output.data[index + 2] = blockBlue;
              output.data[index + 3] = alpha;
            }
          }
        }
      }
      return output;
    }
    case "removeAlpha": {
      const output = cloneImage(image);
      for (let index = 3; index < output.data.length; index += 4) output.data[index] = 255;
      return output;
    }
    case "ensureAlpha": {
      const output = cloneImage(image);
      const alpha = operation.alpha === undefined ? 255 : clamp255(operation.alpha * 255);
      for (let index = 3; index < output.data.length; index += 4) {
        if ((output.data[index] as number) === 0) output.data[index] = alpha;
      }
      return output;
    }
    case "opacity": {
      const output = cloneImage(image);
      for (let index = 3; index < output.data.length; index += 4) {
        output.data[index] = clamp255((output.data[index] as number) * operation.factor);
      }
      return output;
    }
    case "tint": {
      const [red, green, blue] = parseColor(operation.color);
      const output = cloneImage(image);
      for (let index = 0; index < output.data.length; index += 4) {
        output.data[index] = clamp255((output.data[index] as number) * (red / 255));
        output.data[index + 1] = clamp255((output.data[index + 1] as number) * (green / 255));
        output.data[index + 2] = clamp255((output.data[index + 2] as number) * (blue / 255));
      }
      return output;
    }
  }
}
