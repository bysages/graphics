import {
  hslToRgb,
  linearToRgb,
  oklabToRgb,
  oklchToRgb,
  parseRgba,
  rgbToHsl,
  rgbToLinear,
  rgbToOklab,
  rgbToOklch,
} from "./color";
import type { ColorInput, RGBA } from "./types";

export interface MixOptions {
  /** 0 returns the first color; 1 returns the second. Default 0.5. */
  amount?: number;
  space?: "rgb" | "hsl" | "linear-srgb" | "oklab" | "oklch";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`Expected a finite number, got ${value}.`);
  return Math.max(0, Math.min(1, value));
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

/** Interpolate two colors. Alpha is interpolated as well. */
export function mixColors(first: ColorInput, second: ColorInput, options: MixOptions = {}): RGBA {
  const amount = clamp01(options.amount ?? 0.5);
  const left = parseRgba(first);
  const right = parseRgba(second);

  if (options.space === "linear-srgb") {
    const first = rgbToLinear(left);
    const second = rgbToLinear(right);
    return {
      ...linearToRgb({
        r: lerp(first.r, second.r, amount),
        g: lerp(first.g, second.g, amount),
        b: lerp(first.b, second.b, amount),
      }),
      a: lerp(left.a, right.a, amount),
    };
  }
  if (options.space === "oklab") {
    const first = rgbToOklab(left);
    const second = rgbToOklab(right);
    return {
      ...oklabToRgb({
        L: lerp(first.L, second.L, amount),
        a: lerp(first.a, second.a, amount),
        b: lerp(first.b, second.b, amount),
      }),
      a: lerp(left.a, right.a, amount),
    };
  }
  if (options.space === "oklch") {
    const first = rgbToOklch(left);
    const second = rgbToOklch(right);
    let hueDelta = second.h - first.h;
    if (hueDelta > 180) hueDelta -= 360;
    if (hueDelta < -180) hueDelta += 360;
    return {
      ...oklchToRgb({
        l: lerp(first.l, second.l, amount),
        c: lerp(first.c, second.c, amount),
        h: (((first.h + hueDelta * amount) % 360) + 360) % 360,
      }),
      a: lerp(left.a, right.a, amount),
    };
  }
  if (options.space === "hsl") {
    const leftHsl = rgbToHsl(left);
    const rightHsl = rgbToHsl(right);
    let hueDelta = rightHsl.h - leftHsl.h;
    if (hueDelta > 180) hueDelta -= 360;
    if (hueDelta < -180) hueDelta += 360;
    return {
      ...hslToRgb({
        h: (leftHsl.h + hueDelta * amount + 360) % 360,
        s: lerp(leftHsl.s, rightHsl.s, amount),
        l: lerp(leftHsl.l, rightHsl.l, amount),
      }),
      a: lerp(left.a, right.a, amount),
    };
  }

  return {
    r: Math.round(lerp(left.r, right.r, amount)),
    g: Math.round(lerp(left.g, right.g, amount)),
    b: Math.round(lerp(left.b, right.b, amount)),
    a: lerp(left.a, right.a, amount),
  };
}

export function lighten(color: ColorInput, amount = 0.1): RGBA {
  const rgba = parseRgba(color);
  const { h, s, l } = rgbToHsl(rgba);
  const rgb = hslToRgb({ h, s, l: clamp01(l + clamp01(amount)) });
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: rgba.a };
}

export function darken(color: ColorInput, amount = 0.1): RGBA {
  const rgba = parseRgba(color);
  const { h, s, l } = rgbToHsl(rgba);
  const rgb = hslToRgb({ h, s, l: clamp01(l - clamp01(amount)) });
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: rgba.a };
}

export function saturate(color: ColorInput, amount = 0.1): RGBA {
  const rgba = parseRgba(color);
  const { h, s, l } = rgbToHsl(rgba);
  const rgb = hslToRgb({ h, s: clamp01(s + clamp01(amount)), l });
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: rgba.a };
}

export function desaturate(color: ColorInput, amount = 0.1): RGBA {
  const rgba = parseRgba(color);
  const { h, s, l } = rgbToHsl(rgba);
  const rgb = hslToRgb({ h, s: clamp01(s - clamp01(amount)), l });
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: rgba.a };
}

export function rotateHue(color: ColorInput, degrees: number): RGBA {
  const rgba = parseRgba(color);
  const { h, s, l } = rgbToHsl(rgba);
  if (!Number.isFinite(degrees)) {
    throw new RangeError(`Degrees must be a finite number, got ${degrees}.`);
  }
  const hue = (((h + degrees) % 360) + 360) % 360;
  return { ...hslToRgb({ h: hue, s, l }), a: rgba.a };
}

/** Blend toward black. */
export function shade(color: ColorInput, amount = 0.1): RGBA {
  return mixColors(color, { r: 0, g: 0, b: 0, a: parseRgba(color).a }, { amount });
}

/** Blend toward white. */
export function tint(color: ColorInput, amount = 0.1): RGBA {
  return mixColors(color, { r: 255, g: 255, b: 255, a: parseRgba(color).a }, { amount });
}

export interface GradientOptions {
  /** Number of returned colors, including both stops. Default 5. */
  steps?: number;
  space?: "rgb" | "hsl" | "linear-srgb" | "oklab" | "oklch";
}

/** Generate an evenly interpolated multi-stop gradient. */
export function generateGradient(
  stops: readonly ColorInput[],
  options: GradientOptions = {},
): RGBA[] {
  if (stops.length < 2) throw new RangeError("A gradient requires at least two stops.");
  const steps = options.steps ?? 5;
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError("Gradient steps must be an integer of at least 2.");
  }

  const result: RGBA[] = [];
  for (let index = 0; index < steps; index += 1) {
    const position = index / (steps - 1);
    const segment = Math.min(stops.length - 2, Math.floor(position * (stops.length - 1)));
    const segmentAmount = position * (stops.length - 1) - segment;
    result.push(
      mixColors(stops[segment]!, stops[segment + 1]!, {
        amount: segmentAmount,
        ...(options.space === undefined ? {} : { space: options.space }),
      }),
    );
  }
  return result;
}
