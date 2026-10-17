import { flattenAlpha, parseRgba, toHex } from "./color";
import type { ColorInput, RGB, RGBA } from "./types";

export interface ContrastOptions {
  /** Candidate used when dark text is more readable. Default #111. */
  dark?: ColorInput;
  /** Candidate used when light text is more readable. Default white. */
  light?: ColorInput;
  /** Minimum WCAG contrast ratio. AA normal text requires 4.5. Default 4.5. */
  threshold?: number;
  /** Opaque backdrop used to flatten a translucent background. Default white. */
  backdrop?: ColorInput;
}

export interface ContrastReport {
  color: RGB;
  hex: string;
  ratio: number;
  passes: boolean;
  threshold: number;
}

function channelLuminance(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance after flattening translucency if needed. */
export function relativeLuminance(
  color: ColorInput,
  backdrop: ColorInput = { r: 255, g: 255, b: 255 },
): number {
  const rendered = flattenAlpha(color, backdrop);
  return (
    0.2126 * channelLuminance(rendered.r) +
    0.7152 * channelLuminance(rendered.g) +
    0.0722 * channelLuminance(rendered.b)
  );
}

/** WCAG contrast ratio for source rendered over backdrop. */
export function contrastRatio(source: ColorInput, backdrop: ColorInput): number {
  const renderedBackdrop = flattenAlpha(backdrop);
  const renderedSource = flattenAlpha(source, renderedBackdrop);
  const firstLuminance = relativeLuminance(renderedSource);
  const secondLuminance = relativeLuminance(renderedBackdrop);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsContrast(
  foreground: ColorInput,
  background: ColorInput,
  threshold = 4.5,
): boolean {
  return contrastRatio(foreground, background) >= threshold;
}

/** Choose black or white unless both fail the requested threshold. */
export function readableTextColor(
  background: ColorInput,
  options: ContrastOptions = {},
): RGB | undefined {
  const dark = parseRgba(options.dark ?? { r: 17, g: 17, b: 17 });
  const light = parseRgba(options.light ?? { r: 255, g: 255, b: 255 });
  const threshold = options.threshold ?? 4.5;
  const renderedBackground = flattenAlpha(background, options.backdrop);
  const renderedDark = flattenAlpha(dark, renderedBackground);
  const renderedLight = flattenAlpha(light, renderedBackground);
  const darkRatio = contrastRatio(renderedDark, renderedBackground);
  const lightRatio = contrastRatio(renderedLight, renderedBackground);

  if (darkRatio >= threshold && lightRatio >= threshold) {
    return darkRatio >= lightRatio
      ? { r: renderedDark.r, g: renderedDark.g, b: renderedDark.b }
      : { r: renderedLight.r, g: renderedLight.g, b: renderedLight.b };
  }
  if (darkRatio >= threshold) return { r: renderedDark.r, g: renderedDark.g, b: renderedDark.b };
  if (lightRatio >= threshold)
    return { r: renderedLight.r, g: renderedLight.g, b: renderedLight.b };
  return undefined;
}

/** Pick the highest-contrast candidate after rendering it over the background. */
export function bestReadableColor(background: ColorInput, candidates: readonly ColorInput[]): RGBA {
  if (candidates.length === 0) throw new RangeError("At least one candidate color is required.");
  const renderedBackground = flattenAlpha(background);
  let best = flattenAlpha(candidates[0]!, renderedBackground);
  let bestRatio = contrastRatio(best, renderedBackground);
  for (const candidate of candidates.slice(1)) {
    const rendered = flattenAlpha(candidate, renderedBackground);
    const ratio = contrastRatio(rendered, renderedBackground);
    if (ratio > bestRatio) {
      best = rendered;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Test every palette color against one background. */
export function analyzePaletteContrast(
  palette: readonly ColorInput[],
  background: ColorInput,
  threshold = 4.5,
): ContrastReport[] {
  const renderedBackground = flattenAlpha(background);
  return palette.map((entry) => {
    const rendered = flattenAlpha(entry, renderedBackground);
    const ratio = contrastRatio(rendered, renderedBackground);
    return {
      color: { r: rendered.r, g: rendered.g, b: rendered.b },
      hex: toHex(rendered),
      ratio,
      passes: ratio >= threshold,
      threshold,
    };
  });
}
