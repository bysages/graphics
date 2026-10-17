import type { ImageInput, RawImageData } from "../types";

export function isRawImageData(input: ImageInput): input is RawImageData {
  return (
    typeof input === "object" &&
    input !== null &&
    "data" in input &&
    "width" in input &&
    "height" in input &&
    "layout" in input
  );
}
