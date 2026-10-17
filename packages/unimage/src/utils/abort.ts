import { UnImageError } from "../errors";

export function assertNotAborted(signal: AbortSignal | undefined, stage: string): void {
  if (signal?.aborted) {
    throw new UnImageError(`Image ${stage} was aborted.`, { code: "UNIMAGE_ABORT" });
  }
}

/**
 * Reject as soon as the caller aborts. Native engines may continue their current
 * task in the background, but the result is discarded instead of returned.
 */
export async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  stage: string,
): Promise<T> {
  assertNotAborted(signal, stage);
  if (signal === undefined) return await promise;
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        listener = () =>
          reject(new UnImageError(`Image ${stage} was aborted.`, { code: "UNIMAGE_ABORT" }));
        signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    if (listener !== undefined) signal.removeEventListener("abort", listener);
  }
}
