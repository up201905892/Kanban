const FALLBACK = '/';
// Resolving against a fake origin lets the URL parser normalise tricks such as tabs,
// backslashes and encoded slashes before we compare origins.
const BASE = 'http://kanban.invalid';
// Control characters (tab, newline, DEL...) are used to smuggle URLs past naive checks.
const hasControlCharacter = (value: string) =>
  Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

/**
 * Returns `next` only when it is a same-origin relative path (`/projects/1?x=2`).
 * Absolute, protocol-relative, `javascript:` and malformed values fall back to `/`.
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/')) return FALLBACK;
  if (next.startsWith('//') || next.includes('\\')) return FALLBACK;
  if (hasControlCharacter(next)) return FALLBACK;
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return FALLBACK;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return FALLBACK;
  }
}

/** Builds `/login?next=<path>`; omits `next` when the path is the home page. */
export function loginPathFor(path: string): string {
  const safe = sanitizeNext(path);
  return safe === '/' ? '/login' : `/login?next=${encodeURIComponent(safe)}`;
}
