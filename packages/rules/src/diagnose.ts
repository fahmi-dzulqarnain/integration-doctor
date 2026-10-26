import { detect } from './detect.js';
import { normaliseHeaders, parseBody, parseUrl } from './input.js';
import { authRules } from './rules/auth.js';
import type { Rule } from './rules/context.js';
import { environmentRules } from './rules/environment.js';
import { payloadRules } from './rules/payload.js';
import { trackingRules } from './rules/tracking.js';
import type { Diagnosis, RequestInput, Severity } from './types.js';

const RULES: Rule[] = [...environmentRules, ...authRules, ...trackingRules, ...payloadRules];
const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export interface DiagnoseOptions {
  /** Defaults to the current time; set it to make date checks reproducible. */
  now?: Date;
}

/**
 * Checks a DHL API request without sending it. Every finding comes from a fixed rule with a
 * cited source; nothing here calls DHL or an AI model.
 */
export function diagnose(request: RequestInput, options: DiagnoseOptions = {}): Diagnosis {
  // Input may come from a form or a paste, so nothing is assumed about its types.
  const method = typeof request.method === 'string' ? request.method : '';
  const url = parseUrl(request.url);
  const detection = detect(method, url);
  const context = {
    method,
    rawUrl: typeof request.url === 'string' ? request.url : String(request.url),
    url,
    headers: normaliseHeaders(request.headers),
    rawBody: request.body,
    body: parseBody(request.body),
    detection,
    now: options.now ?? new Date(),
  };
  const findings = RULES.flatMap((rule) => rule(context))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return { detection, findings };
}
