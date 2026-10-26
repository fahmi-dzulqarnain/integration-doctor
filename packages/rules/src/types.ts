/** Which DHL API a request or response belongs to, decided from its URL. */
export type DhlApi =
  | 'tracking'
  | 'location-finder'
  | 'mydhl'
  | 'parcel-de-shipping'
  | 'legacy-express'
  | 'unknown';

export type Environment = 'production' | 'sandbox' | 'test' | 'mock' | 'unknown';

export type Severity = 'error' | 'warning' | 'info';

/**
 * Where a claim comes from. `official` is DHL's own documentation or API specification;
 * anything else is community evidence (an integrator's help centre, a public issue) and is
 * labelled as such wherever it is shown.
 */
export interface Source {
  label: string;
  url: string;
  official: boolean;
}

/** One problem found in a request, with what to do about it. */
export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  fix: string;
  /** JSON path into the body, e.g. `customerDetails.shipperDetails.postalAddress.cityName`. */
  path?: string;
  sources: Source[];
}

/** Header input as people paste it: an object, or a list of name/value pairs. */
export type HeadersInput = Record<string, string> | readonly (readonly [string, string])[];

export interface RequestInput {
  method: string;
  url: string;
  headers?: HeadersInput;
  body?: string;
}

export interface Detection {
  api: DhlApi;
  environment: Environment;
  /**
   * The operation relative to the API's server URL, as DHL's specification names it, e.g.
   * `GET /shipments` or `GET /shipments/{shipmentTrackingNumber}/tracking`. When the request
   * matches no endpoint in the specification, this is the method and path as sent.
   */
  operation?: string;
  /** False when the method and path match no endpoint in DHL's specification. */
  knownEndpoint?: boolean;
  /** For a known path sent with the wrong method: the methods the path does take. */
  allowedMethods?: string[];
}

export interface Diagnosis {
  detection: Detection;
  findings: Finding[];
}

export interface ResponseInput {
  status: number;
  body?: string;
  headers?: HeadersInput;
  /** The request that produced it, when known: it narrows the API and adds request findings. */
  request?: RequestInput;
}

/** A known DHL error, matched against a response. */
export interface CatalogueEntry {
  id: string;
  /** The APIs whose responses this entry describes. */
  api: DhlApi | 'any' | readonly DhlApi[];
  /** DHL's own error code where it has one, e.g. `998`. */
  code?: string;
  status?: number;
  /** Matched against the response body text, case-insensitively. */
  pattern?: RegExp;
  title: string;
  meaning: string;
  causes: string[];
  fixes: string[];
  sources: Source[];
}

export interface Explanation {
  detection: Detection;
  /** DHL's error code, when the body carries one: the first that matched, else the first found. */
  code?: string;
  /** Every DHL error code in the body, in order (MyDHL can report several). */
  codes: string[];
  /** DHL's own message, as sent. */
  message?: string;
  /** The JSON path DHL names in a schema error, e.g. `customerDetails.shipperDetails`. */
  path?: string;
  matches: CatalogueEntry[];
  /** Findings for the request, when one was given. */
  requestFindings: Finding[];
}
