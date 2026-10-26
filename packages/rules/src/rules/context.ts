import type { ParsedBody } from '../input.js';
import type { Detection, Finding } from '../types.js';

/** Everything a rule may look at, parsed once. */
export interface RuleContext {
  method: string;
  rawUrl: string;
  url: URL | undefined;
  headers: Map<string, string>;
  rawBody: string | undefined;
  body: ParsedBody;
  detection: Detection;
  /** "Now", injectable so date rules are testable. */
  now: Date;
}

export type Rule = (context: RuleContext) => Finding[];
