import type { ImageInput } from "../types";

const mediaTypes: Partial<Record<import("../types").ImageFormat, string>> = {
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pnm: "image/x-portable-anymap",
  tga: "image/x-tga",
};

export function mediaTypeForFormat(format: import("../types").ImageFormat): string {
  return mediaTypes[format] ?? `image/${format}`;
}

export type SniffedImageFormat =
  | "png"
  | "jpeg"
  | "webp"
  | "avif"
  | "gif"
  | "svg"
  | "heic"
  | "heif"
  | "tiff"
  | "bmp"
  | "ico"
  | "jxl"
  | "pnm"
  | undefined;

const magic: Array<[SniffedImageFormat, readonly number[]]> = [
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpeg", [0xff, 0xd8, 0xff]],
  ["gif", [0x47, 0x49, 0x46, 0x38]],
  ["bmp", [0x42, 0x4d]],
];

function matchMagic(bytes: Uint8Array): SniffedImageFormat {
  for (const [format, prefix] of magic) {
    if (prefix.every((byte, index) => bytes[index] === byte)) return format;
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "webp";
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70 && // p
    (bytes[8] === 0x61 || bytes[8] === 0x73) // "avif" / "avis"
  ) {
    return "avif";
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70 && // p
    bytes[8] === 0x6d // "mif1" HEIF container
  ) {
    return "heif";
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70 && // p
    bytes[8] === 0x68 // "h" (heic/heix/hevc/hevx)
  ) {
    return "heic";
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) || // "II*\0"
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 0x2a)) // "MM\0*"
  ) {
    return "tiff";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return "ico";
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0x0a) {
    return "jxl";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x4a &&
    bytes[1] === 0x58 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x20 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x87 &&
    bytes[7] === 0x0a
  ) {
    return "jxl";
  }
  if (
    bytes.length >= 2 &&
    bytes[0] === 0x50 &&
    (bytes[1] as number) >= 0x31 &&
    (bytes[1] as number) <= 0x37
  ) {
    return "pnm";
  }
  return undefined;
}

/**
 * Best-effort input format sniffing from magic bytes (or an SVG text
 * prefix). Returns `undefined` when the format cannot be determined, which
 * lets callers fall back to driver-side detection.
 */
export async function sniffImageFormat(input: ImageInput): Promise<SniffedImageFormat> {
  if (typeof input === "object" && input !== null && "layout" in input) return undefined;
  let bytes: Uint8Array;
  if (input instanceof Blob) {
    bytes = new Uint8Array(await input.slice(0, 256).arrayBuffer());
  } else if (input instanceof Uint8Array) {
    bytes = input.subarray(0, 256);
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input).subarray(0, 256);
  } else {
    return undefined;
  }

  const fromMagic = matchMagic(bytes);
  if (fromMagic !== undefined) return fromMagic;

  const prefix = svgCandidatePrefix(bytes);
  return prefix.startsWith("<svg") ? "svg" : undefined;
}

function svgCandidatePrefix(bytes: Uint8Array): string {
  let text = new TextDecoder().decode(bytes.subarray(0, 4096)).trimStart();
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.trimStart();
    if (text.startsWith("\uFEFF")) text = text.slice(1);
    if (text.startsWith("<?")) {
      const end = text.indexOf("?>");
      if (end === -1) break;
      text = text.slice(end + 2);
    }
    if (text.startsWith("<!--")) {
      const end = text.indexOf("-->");
      if (end === -1) break;
      text = text.slice(end + 3);
    }
    if (/^<!doctype/i.test(text)) {
      const end = text.indexOf(">");
      if (end === -1) break;
      text = text.slice(end + 1);
    }
  }
  return text.trimStart().slice(0, 128).toLowerCase();
}
