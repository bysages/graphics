export type UnImageErrorCode =
  | "UNIMAGE_INVALID_INPUT"
  | "UNIMAGE_INVALID_RECIPE"
  | "UNIMAGE_UNSUPPORTED_FORMAT"
  | "UNIMAGE_UNSUPPORTED_OPERATION"
  | "UNIMAGE_DECODE"
  | "UNIMAGE_ENCODE"
  | "UNIMAGE_ABORT"
  | "UNIMAGE_DRIVER_UNAVAILABLE";

export interface UnImageErrorOptions {
  code: UnImageErrorCode;
  operation?: string | undefined;
  format?: string | undefined;
  cause?: unknown;
}

export class UnImageError extends Error {
  readonly code: UnImageErrorCode;
  readonly operation?: string | undefined;
  readonly format?: string | undefined;

  constructor(message: string, options: UnImageErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "UnImageError";
    this.code = options.code;
    if (options.operation !== undefined) this.operation = options.operation;
    if (options.format !== undefined) this.format = options.format;
  }
}
