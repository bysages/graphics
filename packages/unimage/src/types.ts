export type ImageFormat =
  | "png"
  | "jpeg"
  | "webp"
  | "avif"
  | "gif"
  | "svg"
  | "tiff"
  | "heif"
  | "heic"
  | "bmp"
  | "ico"
  | "jxl"
  | "pnm"
  | "tga";

export type RawImageLayout = "rgba8";

export interface RawImageData {
  data: Uint8Array;
  width: number;
  height: number;
  layout: RawImageLayout;
}

export type ImageInput = Blob | Uint8Array | ArrayBuffer | RawImageData;

export interface ImageDensity {
  x: number;
  y?: number;
  unit: "inch" | "cm";
}

export interface ImageMetadata {
  format?: ImageFormat;
  mediaType?: string;
  width: number;
  height: number;
  byteLength?: number;
  hasAlpha?: boolean;
  orientation?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  density?: ImageDensity;
  pages?: number;
}

export type FitMode = "contain" | "cover" | "fill" | "outside";
export type ResizeKernel = "nearest" | "linear" | "cubic" | "mitchell" | "lanczos2" | "lanczos3";

export type ImagePosition =
  | "top"
  | "right top"
  | "right"
  | "right bottom"
  | "bottom"
  | "left bottom"
  | "left"
  | "left top"
  | "center"
  | "entropy"
  | "attention";
export type FlipAxis = "horizontal" | "vertical";
export type MetadataPolicy = "preserve" | "strip";

export interface ResizeOperation {
  type: "resize";
  width?: number;
  height?: number;
  fit?: FitMode;
  withoutEnlargement?: boolean;
  kernel?: ResizeKernel;
  position?: ImagePosition;
}

export interface CropOperation {
  type: "crop";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RotateOperation {
  type: "rotate";
  angle: number;
  background?: string;
}

export interface FlipOperation {
  type: "flip";
  axis: FlipAxis;
}

export interface BlurOperation {
  type: "blur";
  sigma: number;
}

export interface TrimOperation {
  type: "trim";
  threshold?: number;
}

export type ExtendMode = "background" | "copy" | "repeat" | "mirror";

export interface ExtendOperation {
  type: "extend";
  top: number;
  right: number;
  bottom: number;
  left: number;
  background?: string;
  extendWith?: ExtendMode;
}

export interface SharpenOperation {
  type: "sharpen";
  sigma?: number;
  flat?: number;
  jagged?: number;
}

export interface MedianOperation {
  type: "median";
  size: number;
}

export interface MorphologyOperation {
  type: "dilate" | "erode";
  size: number;
}

export interface ClaheOperation {
  type: "clahe";
  width: number;
  height: number;
  maxSlope?: number;
}

export interface FlattenOperation {
  type: "flatten";
  background?: string;
}

export interface UnflattenOperation {
  type: "unflatten";
}

export interface GammaOperation {
  type: "gamma";
  gamma: number;
  gammaOut?: number;
}

export interface NormalizeOperation {
  type: "normalize";
  lower?: number;
  upper?: number;
}

export interface ThresholdOperation {
  type: "threshold";
  value: number;
  grayscale?: boolean;
}

export interface LinearOperation {
  type: "linear";
  a?: number;
  b?: number;
}

export interface ModulateOperation {
  type: "modulate";
  brightness?: number;
  saturation?: number;
  hue?: number;
  lightness?: number;
}

export interface OpacityOperation {
  type: "opacity";
  factor: number;
}

export interface TintOperation {
  type: "tint";
  color: string;
}

export interface ContrastOperation {
  type: "contrast";
  /** -100 decreases contrast; 100 increases contrast. */
  amount: number;
}

export interface ConvolveOperation {
  kernel: readonly number[];
  width: number;
  height: number;
  scale?: number;
  offset?: number;
  border?: "copy" | "mirror";
}

export interface RemoveAlphaOperation {
  type: "removeAlpha";
}

export interface EnsureAlphaOperation {
  type: "ensureAlpha";
  alpha?: number;
}
/** Integer from 1 through 100. */
export type Quality = number;

export type FrameSelection = "first" | "all";
export type FrameSupport = "still" | "animated" | "pages";
export type CompressionMode = "lossy" | "lossless";

export interface ImageInputOptions {
  format?: ImageFormat;
  frames?: FrameSelection;
  /** SVG rasterization density, in pixels per inch. */
  rasterDensity?: number;
}

export interface ImageInputDecodeOptions {
  /** SVG rasterization density, in pixels per inch. */
  rasterDensity?: number;
}

export interface RawImageFrame extends RawImageData {
  metadata: ImageMetadata;
}

export interface RawImageSequence {
  frames: readonly RawImageFrame[];
  metadata: ImageMetadata;
}

export interface DecodeCapability {
  /** Pixel layouts available from encoded input. */
  pixelFormats: readonly RawImageLayout[];
  frames: readonly FrameSupport[];
  orientation: boolean;
  rasterDensity: boolean;
  vector: boolean;
}

export interface EncodeCapability {
  compressionModes: readonly CompressionMode[];
  quality: boolean;
  animation: boolean;
  metadataPolicies: readonly MetadataPolicy[];
  sanitize: boolean;
}

export interface FormatCapabilities {
  decode?: DecodeCapability;
  encode?: EncodeCapability;
}

export type ImageOutput =
  | { format: "svg"; metadataPolicy?: MetadataPolicy }
  | { format: "png" | "gif"; metadataPolicy?: MetadataPolicy }
  | { format: "jpeg"; quality?: Quality; metadataPolicy?: MetadataPolicy }
  | {
      format: "webp" | "avif" | "heif" | "heic";
      quality?: Quality;
      lossless?: boolean;
      metadataPolicy?: MetadataPolicy;
    }
  | { format: "tiff"; quality?: Quality; metadataPolicy?: MetadataPolicy }
  | { format: "bmp" | "ico" | "pnm" | "tga"; metadataPolicy?: MetadataPolicy }
  | {
      format: "jxl";
      quality?: Quality;
      lossless?: boolean;
      metadataPolicy?: MetadataPolicy;
    };

export type ImageOperation =
  | { type: "autoOrient" }
  | ResizeOperation
  | CropOperation
  | RotateOperation
  | FlipOperation
  | { type: "grayscale" }
  | { type: "invert" }
  | BlurOperation
  | TrimOperation
  | ExtendOperation
  | SharpenOperation
  | MedianOperation
  | MorphologyOperation
  | ClaheOperation
  | FlattenOperation
  | UnflattenOperation
  | GammaOperation
  | NormalizeOperation
  | ThresholdOperation
  | LinearOperation
  | ModulateOperation
  | OpacityOperation
  | TintOperation
  | ContrastOperation
  | (ConvolveOperation & { type: "convolve" })
  | RemoveAlphaOperation
  | EnsureAlphaOperation;

export type ImageOperationType = ImageOperation["type"];

export interface ImageRecipe {
  input?: ImageInputOptions;
  operations: readonly ImageOperation[];
  output: ImageOutput;
}

export interface ImagePipelineConfig extends ImageRecipe {
  /** Required when checking an encoded source. Raw pixel input has no format. */
  input: ImageInputOptions;
}

export interface EncodedImageResult {
  kind: "encoded";
  data: Uint8Array;
  format: ImageFormat;
  mediaType: string;
  metadata: ImageMetadata;
}

export interface VectorImageResult {
  kind: "vector";
  data: Uint8Array;
  format: "svg";
  mediaType: string;
  metadata: ImageMetadata;
}

export type ImageResult = EncodedImageResult | VectorImageResult;

export interface OperationCapability {
  supported: boolean;
  notes?: readonly string[];
}

export interface ImageCapabilities {
  driver: string;
  formats: Partial<Record<ImageFormat, FormatCapabilities>>;
  operations: Partial<Record<ImageOperationType, OperationCapability>>;
  metadataRead: boolean;
  notes?: readonly string[];
}

export type ImageCapabilitySection = "input" | "operations" | "output";

export interface ImageCapabilityIssue {
  section: ImageCapabilitySection;
  key: string;
  reason: "unsupported" | "invalid";
}

export interface ImageCapabilityResult {
  supported: boolean;
  driver: string;
  missing: readonly ImageCapabilityIssue[];
  capabilities: ImageCapabilities;
}

export interface DriverRequestContext {
  signal?: AbortSignal | undefined;
}

export interface ImageDecodeRequest extends ImageInputDecodeOptions {
  signal?: AbortSignal | undefined;
}

export interface ImageDriver {
  readonly name: string;
  capabilities(): Promise<ImageCapabilities>;
  checkRecipe(recipe: ImagePipelineConfig): Promise<ImageCapabilityResult>;
  metadata(input: ImageInput, context?: DriverRequestContext): Promise<ImageMetadata>;
  decode?(input: ImageInput, request: ImageDecodeRequest): Promise<RawImageFrame>;
  decodeFrames?(input: ImageInput, request: ImageDecodeRequest): Promise<RawImageSequence>;
  transform(
    input: ImageInput,
    recipe: ImageRecipe,
    context?: DriverRequestContext,
  ): Promise<ImageResult>;
  dispose?(): Promise<void> | void;
}

export interface ImageManager {
  readonly driverName: string;
  capabilities(): Promise<ImageCapabilities>;
  isConfigSupported(config: ImageRecipe): Promise<ImageCapabilityResult>;
  metadata(input: ImageInput, options?: { signal?: AbortSignal }): Promise<ImageMetadata>;
  decode(
    input: ImageInput,
    options?: ImageInputDecodeOptions & { signal?: AbortSignal },
  ): Promise<RawImageFrame>;
  decodeFrames(
    input: ImageInput,
    options?: ImageInputDecodeOptions & { signal?: AbortSignal },
  ): Promise<RawImageSequence>;
  transform(
    input: ImageInput,
    recipe: ImageRecipe,
    options?: { signal?: AbortSignal },
  ): Promise<ImageResult>;
  dispose(): Promise<void>;
}

export interface ImageManagerOptions {
  driver: ImageDriver;
}
