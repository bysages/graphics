export function normalizeMaxAge(value: unknown): number | undefined {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
    ? Math.min(Math.floor(parsed), 2 ** 31)
    : undefined;
}
