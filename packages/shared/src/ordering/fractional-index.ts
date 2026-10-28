/**
 * Fractional indexing with base-62 string keys.
 *
 * A key is an "integer part" (a head letter that encodes its length, followed by
 * digits) plus an optional "fractional part" (digits, never ending in '0').
 * Keys sort correctly with a plain code-unit string comparison.
 *
 * The algorithm follows David Greenspan's fractional indexing scheme (the same
 * one used by the `fractional-indexing` package); it is implemented here so the
 * shared package keeps no extra runtime dependency (G9).
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const ZERO = DIGITS.charAt(0);
const LAST_DIGIT = DIGITS.charAt(BASE - 1);
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;
const INTEGER_ZERO = `a${ZERO}`;

/** Keys longer than this must be rebalanced (see ADR 0001). */
export const MAX_KEY_LENGTH = 50;

export class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKeyError';
  }
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  throw new InvalidKeyError(`Invalid key head: ${head}`);
}

function integerPart(key: string): string {
  const len = integerLength(key.charAt(0));
  if (len > key.length) throw new InvalidKeyError(`Invalid key: ${key}`);
  return key.slice(0, len);
}

function allDigits(s: string): boolean {
  for (const ch of s) if (!DIGITS.includes(ch)) return false;
  return true;
}

/** True when `key` is a well-formed position key. */
export function isValidKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0 || key === SMALLEST_INTEGER) return false;
  let int: string;
  try {
    int = integerPart(key);
  } catch {
    return false;
  }
  const frac = key.slice(int.length);
  return allDigits(int.slice(1)) && allDigits(frac) && !frac.endsWith(ZERO);
}

function assertValid(key: string | null): void {
  if (key !== null && !isValidKey(key)) {
    throw new InvalidKeyError(`Invalid position key: ${String(key)}`);
  }
}

/** Midpoint of two fractional-digit strings; `b` null means "no upper bound". */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a.charAt(0)) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b.charAt(0)) : BASE;
  if (digitB - digitA > 1) {
    return DIGITS.charAt(Math.round(0.5 * (digitA + digitB)));
  }
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

function incrementInteger(x: string): string | null {
  const head = x.charAt(0);
  const digs = x.slice(1).split('');
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i] as string) + 1;
    if (d === BASE) digs[i] = ZERO;
    else {
      digs[i] = DIGITS.charAt(d);
      carry = false;
    }
  }
  if (carry) {
    if (head === 'Z') return INTEGER_ZERO;
    if (head === 'z') return null;
    const h = String.fromCharCode(head.charCodeAt(0) + 1);
    if (h > 'a') digs.push(ZERO);
    else digs.pop();
    return h + digs.join('');
  }
  return head + digs.join('');
}

function decrementInteger(x: string): string | null {
  const head = x.charAt(0);
  const digs = x.slice(1).split('');
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i] as string) - 1;
    if (d === -1) digs[i] = LAST_DIGIT;
    else {
      digs[i] = DIGITS.charAt(d);
      borrow = false;
    }
  }
  if (borrow) {
    if (head === 'a') return `Z${LAST_DIGIT}`;
    if (head === 'A') return null;
    const h = String.fromCharCode(head.charCodeAt(0) - 1);
    if (h < 'Z') digs.push(LAST_DIGIT);
    else digs.pop();
    return h + digs.join('');
  }
  return head + digs.join('');
}

/**
 * A key strictly between `a` and `b`. `null` means "no neighbour on that side".
 * Throws `InvalidKeyError` for malformed keys or when `a >= b`.
 */
export function keyBetween(a: string | null, b: string | null): string {
  assertValid(a);
  assertValid(b);
  if (a !== null && b !== null && a >= b) {
    throw new InvalidKeyError(`Lower key must be smaller than upper key: ${a} >= ${b}`);
  }
  if (a === null && b === null) return INTEGER_ZERO;
  if (a === null) {
    const upper = b as string;
    const ib = integerPart(upper);
    const fb = upper.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < upper) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new InvalidKeyError('Cannot decrement any further');
    return res;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  if (b === null) {
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new InvalidKeyError('Cannot increment any further');
  return i < b ? i : ia + midpoint(fa, null);
}

/** `n` strictly increasing keys between `a` and `b`, spread to keep keys short. */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer');
  if (n === 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  if (b === null) {
    let c = keyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = keyBetween(c, b);
      result.push(c);
    }
    return result;
  }
  if (a === null) {
    let c = keyBetween(a, b);
    const result = [c];
    for (let i = 0; i < n - 1; i++) {
      c = keyBetween(a, c);
      result.push(c);
    }
    return result.reverse();
  }
  const mid = Math.floor(n / 2);
  const c = keyBetween(a, b);
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)];
}

/** True when a key has outgrown `MAX_KEY_LENGTH` and its siblings should be rebalanced. */
export function needsRebalance(key: string): boolean {
  return key.length > MAX_KEY_LENGTH;
}

export interface Positioned {
  position: string;
  id: string;
}

/** Deterministic order: by position key (code-unit order), ties broken by id. */
export function compareByPosition(x: Positioned, y: Positioned): number {
  if (x.position < y.position) return -1;
  if (x.position > y.position) return 1;
  if (x.id < y.id) return -1;
  if (x.id > y.id) return 1;
  return 0;
}
