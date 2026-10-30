const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const isStateChanging = (method: string): boolean =>
  STATE_CHANGING.has(method.toUpperCase());

/** Normalises a configured web origin (`http://host:port/` -> `http://host:port`). */
export const normalizeOrigin = (value: string): string => new URL(value).origin;

/** True when the request method is safe, or its `Origin` header equals the allowed origin exactly. */
export function isOriginAllowed(
  method: string,
  originHeader: string | undefined,
  allowedOrigin: string,
): boolean {
  if (!isStateChanging(method)) return true;
  if (!originHeader) return false;
  return originHeader === allowedOrigin;
}
