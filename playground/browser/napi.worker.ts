import { Buffer } from "buffer";

import { createImageManager } from "unimage";
import type { ImageOperation } from "unimage";
import type { ImageMetadata } from "unimage";

export interface NapiWorkerRequest {
  id: number;
  operations: ImageOperation[];
  output: { format: string; quality?: number; metadataPolicy: "strip" };
  source: ArrayBuffer;
}

export type NapiWorkerResponse =
  | { kind: "result"; data: ArrayBuffer; metadata: ImageMetadata; mediaType: string }
  | { kind: "unsupported"; message: string }
  | { kind: "error"; message: string };

globalThis.Buffer ??= Buffer;

self.onmessage = async (event: MessageEvent<NapiWorkerRequest>) => {
  const post = (response: NapiWorkerResponse, transfer: Transferable[] = []): void => {
    self.postMessage({ ...response, id: event.data.id }, transfer);
  };

  try {
    const image = createImageManager({
      driver: (await import("unimage/drivers/napi")).napiDriver({
        napiImport: () => import("@napi-rs/image-wasm32-wasi"),
      }),
    });
    const output =
      event.data.output.format === "png"
        ? { format: "png" as const, metadataPolicy: "strip" as const }
        : {
            format: event.data.output.format as "jpeg" | "webp" | "avif",
            quality: event.data.output.quality ?? 82,
            metadataPolicy: "strip" as const,
          };
    const operations = event.data.operations;
    const processed = await image.transform(new Uint8Array(event.data.source), {
      operations,
      output,
    });
    const data = new ArrayBuffer(processed.data.byteLength);
    new Uint8Array(data).set(processed.data);
    post(
      {
        kind: "result",
        data,
        mediaType: processed.mediaType,
        metadata: processed.metadata,
      },
      [data],
    );
  } catch (error) {
    post({
      kind: "error",
      message: error instanceof Error ? error.message : "Napi WASI processing failed.",
    });
  }
};
