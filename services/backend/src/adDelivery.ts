export interface ByteRange {
  start: number;
  end: number;
}

export function findConfiguredAdFile(
  files: string[],
  requested: unknown
): string | undefined {
  if (typeof requested !== 'string') return undefined;
  const name = requested.trim();
  if (!name) return undefined;
  return files.find((file) => file.toLocaleLowerCase() === name.toLocaleLowerCase());
}

export function parseByteRange(value: unknown, size: number): ByteRange | undefined {
  if (typeof value !== 'string' || !Number.isSafeInteger(size) || size <= 0) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) return undefined;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return undefined;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}
