import type { ImageInput } from "../types";

export type SniffedImageFormat =
  | "png"
  | "jpeg"
  | "webp"
  | "avif"
  | "gif"
  | "svg"
  | "heic"
  | "tiff"
  | undefined;

const magic: Array<[SniffedImageFormat, readonly number[]]> = [
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpeg", [0xff, 0xd8, 0xff]],
  ["gif", [0x47, 0x49, 0x46, 0x38]],
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
    (bytes[8] === 0x61 || bytes[8] === 0x6d) // "a" (avif/avis) or "m" (mif1)
  ) {
    return "avif";
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

  const prefix = new TextDecoder().decode(bytes).trimStart().slice(0, 64).toLowerCase();
  if (prefix.startsWith("<?xml") || prefix.startsWith("<svg")) return "svg";
  return undefined;
}
