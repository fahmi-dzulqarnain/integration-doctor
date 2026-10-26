import { CATALOGUE } from './catalogue/entries.js';
import { diagnose, type DiagnoseOptions } from './diagnose.js';
import { isRecord, parseBody } from './input.js';
import type { CatalogueEntry, Detection, Explanation, ResponseInput } from './types.js';

/** "998: ShipTimeStamp is not well formatted…" → 998 */
const CODED_MESSAGE = /^\s*(\d{3,6})\s*:\s*/;
/** "#/customerDetails/shipperDetails: required key…" → customerDetails.shipperDetails */
const JSON_POINTER = /#\/([A-Za-z0-9_~\-/]+)/;
const REQUIRED_KEY = /required key \[([^\]]+)\] not found/i;
/** Codes the catalogue knows for MyDHL; a bare "10115: …" elsewhere is not taken as MyDHL. */
const MYDHL_CODES = new Set(CATALOGUE.filter((e) => e.api === 'mydhl' && e.code).map((e) => e.code));

interface Extracted {
  text: string;
  message?: string;
  codes: string[];
  path?: string;
  mydhlShape: boolean;
}

/** Pulls DHL's codes, message and field path out of the error formats the APIs use. */
function extract(rawBody: string | undefined): Extracted {
  const parsed = parseBody(rawBody);
  const text = typeof rawBody === 'string' ? rawBody : '';
  if (parsed.kind !== 'json' || !isRecord(parsed.value)) return { text, codes: [], mydhlShape: false };
  const body = parsed.value;

  const messages: string[] = [];
  for (const key of ['detail', 'message', 'title']) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) messages.push(value.trim());
  }
  const additional = Array.isArray(body.additionalDetails) ? body.additionalDetails.filter((d): d is string => typeof d === 'string') : [];
  const reasons = Array.isArray(body.reasons)
    ? body.reasons.map((r) => (isRecord(r) && typeof r.msg === 'string' ? r.msg : undefined)).filter((m): m is string => m !== undefined)
    : [];

  const all = [...messages, ...additional, ...reasons];
  const codes = [...new Set(all.map((m) => CODED_MESSAGE.exec(m)?.[1]).filter((c): c is string => c !== undefined))];
  const statusField = typeof body.status === 'string' && /^\d{3,6}$/.test(body.status) && !/^[1-5]\d\d$/.test(body.status) ? body.status : undefined;
  if (statusField && !codes.includes(statusField)) codes.push(statusField);

  const withPointer = all.find((m) => JSON_POINTER.test(m));
  const pointerPath = withPointer ? JSON_POINTER.exec(withPointer)?.[1]?.split('/').filter(Boolean).join('.') : undefined;
  const missingKey = withPointer ? REQUIRED_KEY.exec(withPointer)?.[1] : undefined;
  const path = pointerPath && missingKey ? `${pointerPath}.${missingKey}` : pointerPath;

  const instance = typeof body.instance === 'string' ? body.instance : '';
  return {
    text: all.join('\n') || text,
    ...(all[0] !== undefined && { message: all[0] }),
    codes,
    ...(path !== undefined && { path }),
    mydhlShape: additional.length > 0 || reasons.length > 0 || withPointer !== undefined
      || instance.includes('/expressapi') || codes.some((c) => MYDHL_CODES.has(c)),
  };
}

function apiMatches(entry: CatalogueEntry, detection: Detection): boolean {
  if (entry.api === 'any' || detection.api === 'unknown') return true;
  return typeof entry.api === 'string' ? entry.api === detection.api : entry.api.includes(detection.api);
}

function matches(entry: CatalogueEntry, status: number, detection: Detection, found: Extracted): boolean {
  if (!apiMatches(entry, detection)) return false;
  if (entry.status !== undefined && entry.status !== status) return false;
  if (entry.code !== undefined && !found.codes.includes(entry.code)) return false;
  if (entry.pattern !== undefined && !entry.pattern.test(found.text)) return false;
  // A status-only entry (404, 429) says nothing about other APIs' bodies: require the API.
  if (entry.code === undefined && entry.pattern === undefined && detection.api === 'unknown') return false;
  return true;
}

/** More specific entries first: code and pattern, then code or pattern, then status alone. */
const specificity = (entry: CatalogueEntry) => (entry.code ? 2 : 0) + (entry.pattern ? 1 : 0);

/**
 * Explains a DHL error response: DHL's own codes and message, the catalogue entries they match,
 * and, when the request is given, what is wrong with that request.
 */
export function explain(response: ResponseInput, options: DiagnoseOptions = {}): Explanation {
  const found = extract(response.body);
  const requestDiagnosis = response.request ? diagnose(response.request, options) : undefined;

  let detection: Detection = requestDiagnosis?.detection ?? { api: 'unknown', environment: 'unknown' };
  if (detection.api === 'unknown' && found.mydhlShape) detection = { api: 'mydhl', environment: 'unknown' };

  const matched = CATALOGUE
    .filter((entry) => matches(entry, response.status, detection, found))
    .sort((a, b) => specificity(b) - specificity(a));
  const code = matched.find((e) => e.code !== undefined)?.code ?? found.codes[0];

  return {
    detection,
    ...(code !== undefined && { code }),
    codes: found.codes,
    ...(found.message !== undefined && { message: found.message }),
    ...(found.path !== undefined && { path: found.path }),
    matches: matched,
    requestFindings: requestDiagnosis?.findings ?? [],
  };
}
