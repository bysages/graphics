import { UnImageError } from "../errors";
import type { ImageInput, ImageMetadata } from "../types";

const svgOpeningTag = /<svg\b[^>]*>/i;
const attribute = (name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`, "i");

export function isSvgText(value: string): boolean {
  let text = value.trimStart();
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.trimStart();
    if (text.startsWith("\uFEFF")) text = text.slice(1);
    if (text.startsWith("<?")) {
      const end = text.indexOf("?>");
      if (end === -1) return false;
      text = text.slice(end + 2);
    }
    if (text.startsWith("<!--")) {
      const end = text.indexOf("-->");
      if (end === -1) return false;
      text = text.slice(end + 3);
    }
    if (/^<!doctype/i.test(text)) {
      const end = text.indexOf(">");
      if (end === -1) return false;
      text = text.slice(end + 1);
    }
  }
  return text.trimStart().startsWith("<svg");
}

export async function decodeSvg(input: ImageInput): Promise<string> {
  if (input instanceof Blob) return await input.text();
  if (input instanceof Uint8Array) return new TextDecoder().decode(input);
  if (input instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(input));
  throw new UnImageError("Raw pixel input cannot be decoded as SVG.", {
    code: "UNIMAGE_INVALID_INPUT",
  });
}

export function parseSvgMetadata(svg: string, byteLength?: number): ImageMetadata {
  const openingTag = svg.match(svgOpeningTag)?.[0] ?? "";
  const viewBox = openingTag.match(attribute("viewBox"))?.[1]?.trim().split(/\s+/);
  const widthText = openingTag.match(attribute("width"))?.[1];
  const heightText = openingTag.match(attribute("height"))?.[1];
  const fallbackWidth = viewBox?.[2] === undefined ? undefined : lengthValue(viewBox[2]);
  const fallbackHeight = viewBox?.[3] === undefined ? undefined : lengthValue(viewBox[3]);
  const width = widthText === undefined ? fallbackWidth : lengthValue(widthText);
  const height = heightText === undefined ? fallbackHeight : lengthValue(heightText);
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    throw new UnImageError("The SVG does not declare a usable width and height.", {
      code: "UNIMAGE_INVALID_INPUT",
    });
  }
  return {
    format: "svg",
    mediaType: "image/svg+xml",
    width,
    height,
    ...(byteLength === undefined ? {} : { byteLength }),
  };
}

function lengthValue(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
