import { linearToRgb, parseRgba, rgbToLinear } from "./color";
import type { RGB } from "./types";

export type ColorVisionType = "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

export interface ColorVisionOptions {
  /** 0 is unchanged vision, 1 is full dichromacy or monochromacy. Default 1. */
  severity?: number;
}

type Matrix = readonly [number, number, number, number, number, number, number, number, number];

const matrices: Record<Exclude<ColorVisionType, "achromatopsia">, Matrix> = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078811, 0.930809, 0.148002, 0.004733, 0.691367, 0.3039,
  ],
};

function blendSeverity(
  original: readonly [number, number, number],
  simulated: readonly [number, number, number],
  severity: number,
): [number, number, number] {
  return [
    original[0] + (simulated[0] - original[0]) * severity,
    original[1] + (simulated[1] - original[1]) * severity,
    original[2] + (simulated[2] - original[2]) * severity,
  ];
}

/** Simulate congenital color-vision deficiencies in linear-light sRGB. */
export function simulateColorVision(
  color: RGB | string,
  type: ColorVisionType,
  options: ColorVisionOptions = {},
): RGB {
  const severity = options.severity ?? 1;
  if (!Number.isFinite(severity) || severity < 0 || severity > 1) {
    throw new RangeError("Vision severity must be a number from 0 to 1.");
  }
  const rgba = parseRgba(color);
  const linear = rgbToLinear(rgba);

  if (type === "achromatopsia") {
    const grayLinear = 0.2126 * linear.r + 0.7152 * linear.g + 0.0722 * linear.b;
    const blended = blendSeverity(
      [linear.r, linear.g, linear.b],
      [grayLinear, grayLinear, grayLinear],
      severity,
    );
    return linearToRgb({ r: blended[0], g: blended[1], b: blended[2] });
  }

  const matrix = matrices[type];
  const simulatedLinear = [
    matrix[0] * linear.r + matrix[1] * linear.g + matrix[2] * linear.b,
    matrix[3] * linear.r + matrix[4] * linear.g + matrix[5] * linear.b,
    matrix[6] * linear.r + matrix[7] * linear.g + matrix[8] * linear.b,
  ] as const;
  const blended = blendSeverity([linear.r, linear.g, linear.b], simulatedLinear, severity);
  return linearToRgb({ r: blended[0], g: blended[1], b: blended[2] });
}

export function simulatePaletteVision(
  palette: readonly (RGB | string)[],
  type: ColorVisionType,
  options: ColorVisionOptions = {},
): RGB[] {
  return palette.map((color) => simulateColorVision(color, type, options));
}
