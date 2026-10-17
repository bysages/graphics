import { UnImageError } from "../errors";
import type { CompositeOperation, ImageLayerBindings, RawImageData } from "../types";
import { alignedOrigin } from "./geometry";

export interface PreparedCompositeLayer {
  image: RawImageData;
  left: number;
  top: number;
}

function assertRawImageData(
  value: RawImageData | undefined,
  name: string,
): asserts value is RawImageData {
  if (
    value === undefined ||
    value.layout !== "rgba8" ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width <= 0 ||
    value.height <= 0 ||
    value.data.length !== value.width * value.height * 4
  ) {
    throw new UnImageError(`Composite layer "${name}" must be valid rgba8 pixels.`, {
      code: "UNIMAGE_INVALID_INPUT",
    });
  }
}

export function validateLayerBindings(
  operations: readonly { type: string; layer?: string }[],
  layers: ImageLayerBindings | undefined,
): void {
  for (const operation of operations) {
    if (operation.type !== "composite" || typeof operation.layer !== "string") continue;
    if (layers?.[operation.layer] === undefined) {
      throw new UnImageError(`Composite layer "${operation.layer}" is not bound.`, {
        code: "UNIMAGE_INVALID_INPUT",
      });
    }
    assertRawImageData(layers[operation.layer], operation.layer);
  }
}

export function requireCompositeLayer(
  operation: CompositeOperation,
  layers: ImageLayerBindings | undefined,
): RawImageData {
  const layer = layers?.[operation.layer];
  assertRawImageData(layer, operation.layer);
  return layer;
}

function resolveOrigin(
  base: { width: number; height: number },
  layer: { width: number; height: number },
  operation: CompositeOperation,
): [number, number] {
  if (operation.x !== undefined || operation.y !== undefined) {
    return [operation.x ?? 0, operation.y ?? 0];
  }
  return alignedOrigin(operation.position, base.width - layer.width, base.height - layer.height);
}

function withOpacity(layer: RawImageData, opacity: number): RawImageData {
  if (opacity === 1) return layer;
  const data = layer.data.slice();
  for (let index = 3; index < data.length; index += 4) {
    data[index] = Math.max(0, Math.min(255, Math.round((data[index] as number) * opacity)));
  }
  return { ...layer, data };
}

function cropLayer(
  layer: RawImageData,
  sourceX: number,
  sourceY: number,
  width: number,
  height: number,
): RawImageData {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const source = ((sourceY + row) * layer.width + sourceX) * 4;
    data.set(layer.data.subarray(source, source + width * 4), row * width * 4);
  }
  return { data, width, height, layout: "rgba8" };
}

function tiledLayer(
  base: { width: number; height: number },
  layer: RawImageData,
  originX: number,
  originY: number,
): RawImageData {
  const data = new Uint8Array(base.width * base.height * 4);
  const offsetX = ((originX % layer.width) + layer.width) % layer.width;
  const offsetY = ((originY % layer.height) + layer.height) % layer.height;
  for (let y = 0; y < base.height; y += 1) {
    const sourceY = (y + offsetY) % layer.height;
    for (let x = 0; x < base.width; x += 1) {
      const sourceX = (x + offsetX) % layer.width;
      const source = (sourceY * layer.width + sourceX) * 4;
      const target = (y * base.width + x) * 4;
      data.set(layer.data.subarray(source, source + 4), target);
    }
  }
  return { data, width: base.width, height: base.height, layout: "rgba8" };
}

/**
 * Normalize a composite into a non-negative native overlay. Empty intersections
 * return undefined; tiling is expanded to the destination size so all drivers use
 * the same phase and clipping semantics.
 */
export function prepareCompositeLayer(
  base: { width: number; height: number },
  operation: CompositeOperation,
  layers: ImageLayerBindings | undefined,
): PreparedCompositeLayer | undefined {
  const source = requireCompositeLayer(operation, layers);
  const opacity = operation.opacity ?? 1;
  const [originX, originY] = resolveOrigin(base, source, operation);

  if (operation.tile === true) {
    return {
      image: withOpacity(tiledLayer(base, source, originX, originY), opacity),
      left: 0,
      top: 0,
    };
  }

  const left = Math.max(0, originX);
  const top = Math.max(0, originY);
  const right = Math.min(base.width, originX + source.width);
  const bottom = Math.min(base.height, originY + source.height);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return undefined;

  return {
    image: withOpacity(cropLayer(source, left - originX, top - originY, width, height), opacity),
    left,
    top,
  };
}
