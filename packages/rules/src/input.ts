import type { HeadersInput } from './types.js';

/**
 * Header names lowercased, the way HTTP treats them (DHL's Tracking reference announces that its
 * own response headers became lowercase on 27-04-2026). Values are coerced to strings, because
 * pasted or form-built input is not always typed.
 */
export function normaliseHeaders(input: HeadersInput | undefined): Map<string, string> {
  const headers = new Map<string, string>();
  if (!input) return headers;
  const pairs: readonly (readonly [unknown, unknown])[] = isPairList(input) ? input : Object.entries(input);
  for (const [name, value] of pairs) {
    headers.set(String(name).trim().toLowerCase(), String(value));
  }
  return headers;
}

function isPairList(input: HeadersInput): input is readonly (readonly [string, string])[] {
  return Array.isArray(input);
}

export function parseUrl(raw: unknown): URL | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    return new URL(raw.trim());
  } catch {
    return undefined;
  }
}

export type ParsedBody =
  | { kind: 'none' }
  | { kind: 'json'; value: unknown; hasBom: boolean }
  | { kind: 'invalid'; error: string; hasBom: boolean };

export function parseBody(raw: unknown): ParsedBody {
  if (typeof raw !== 'string' || raw.trim() === '') return { kind: 'none' };
  const hasBom = raw.startsWith('﻿');
  try {
    return { kind: 'json', value: JSON.parse(hasBom ? raw.slice(1) : raw) as unknown, hasBom };
  } catch (error) {
    return { kind: 'invalid', error: error instanceof Error ? error.message : String(error), hasBom };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads `a.b.0.c` out of parsed JSON; undefined when any step is missing. */
export function at(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (Array.isArray(current)) current = current[Number(key)];
    else if (isRecord(current)) current = current[key];
    else return undefined;
  }
  return current;
}

/** String length as JSON Schema counts it: in code points, so an emoji is one character. */
export function codePoints(value: string): number {
  // A /u regular expression matches whole code points, not UTF-16 units.
  return value.match(/[\s\S]/gu)?.length ?? 0;
}
