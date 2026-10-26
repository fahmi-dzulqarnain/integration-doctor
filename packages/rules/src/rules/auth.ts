import { SOURCES } from '../sources.js';
import type { Finding } from '../types.js';
import type { Rule } from './context.js';

const API_KEY_HEADER = 'dhl-api-key';

/** Decodes a Basic credential; undefined when it is not `Basic base64(user:password)`. */
export function decodeBasic(authorization: string | undefined): { user: string } | undefined {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(authorization ?? '');
  if (!match?.[1]) return undefined;
  try {
    const decoded = atob(match[1]);
    const colon = decoded.indexOf(':');
    if (colon <= 0) return undefined;
    return { user: decoded.slice(0, colon) };
  } catch {
    return undefined;
  }
}

/**
 * `Basic <credentials>`: a placeholder people (and assistants) use instead of a real secret.
 * The scheme is right and there is nothing to decode, so it gets a note instead of an error;
 * the note matters because the same brackets left in a real request make DHL answer 401.
 */
const PLACEHOLDER_BASIC = /^Basic\s+<[^<>]+>\s*$/i;

const placeholderNote = (source: Finding['sources'][number]): Finding => ({
  ruleId: 'auth.placeholder',
  severity: 'info',
  title: 'The Basic credential is a placeholder',
  detail: 'The checks treat "Basic <…>" as a stand-in for real credentials. Sent as it is, with the angle brackets, DHL rejects it with 401.',
  fix: 'When you send the request, replace the whole <…>, brackets included, with base64(username + ":" + password).',
  sources: [source],
});

/** Tracking and Location Finder: an API key in the `DHL-API-Key` header. */
const keyHeaderRules: Rule = ({ detection, headers }) => {
  if (detection.api !== 'tracking' && detection.api !== 'location-finder') return [];
  const reference = detection.api === 'tracking' ? SOURCES.trackingReference : SOURCES.locationFinderReference;
  const key = headers.get(API_KEY_HEADER);

  if (key === undefined) {
    const authorization = headers.get('authorization');
    return [{
      ruleId: 'auth.missing-api-key',
      severity: 'error',
      title: 'No DHL-API-Key header',
      detail: authorization
        ? 'The request sends an Authorization header. This API ignores it: it only reads an API key from the DHL-API-Key header, so DHL answers 401 "Access to the resource is not allowed."'
        : 'This API needs an API key in the DHL-API-Key header. Without it DHL answers 401 "Access to the resource is not allowed."',
      fix: 'Add the header DHL-API-Key: <your key>, using the key of an app in My Apps that has this API added.',
      sources: [SOURCES.tracking401, reference],
    }];
  }

  const findings: Finding[] = [];
  const trimmed = key.trim();
  if (trimmed === 'demo-key') {
    findings.push({
      ruleId: 'auth.demo-key',
      severity: 'info',
      title: 'demo-key returns mocked data',
      detail: 'DHL answers demo-key with one fixed, mocked shipment, whatever tracking number you send. It proves your request reaches DHL, not that a real shipment can be tracked.',
      fix: 'Request a key for Shipment Tracking – Unified in My Apps to see real shipments.',
      sources: [SOURCES.trackingReference, SOURCES.sampleNumbers],
    });
  } else if (trimmed !== key || /^["']|["']$/.test(trimmed) || /^(bearer|basic)\s/i.test(trimmed)) {
    findings.push({
      ruleId: 'auth.malformed-api-key',
      severity: 'error',
      title: 'The DHL-API-Key value has extra characters',
      detail: 'The key has surrounding spaces, quotes, or a "Bearer"/"Basic" prefix. DHL compares the exact value, so it rejects the key.',
      fix: 'Send only the key itself: DHL-API-Key: abc123…',
      sources: [SOURCES.tracking401],
    });
  }
  return findings;
};

/** MyDHL API: HTTP Basic, sent on every request. */
const basicRules: Rule = ({ detection, headers }) => {
  if (detection.api !== 'mydhl' || detection.environment === 'mock') return [];
  const authorization = headers.get('authorization');

  if (!authorization) {
    const sentKey = headers.has(API_KEY_HEADER);
    return [{
      ruleId: 'auth.mydhl-missing-basic',
      severity: 'error',
      title: 'MyDHL API needs Basic authentication',
      detail: sentKey
        ? 'The request sends DHL-API-Key, the scheme used by Shipment Tracking. MyDHL API authenticates with HTTP Basic instead, so it answers 401 "Invalid Credentials".'
        : 'No Authorization header. DHL\'s reference asks for HTTP Basic to be sent pre-emptively on every request, rather than after a 401 challenge.',
      fix: 'Send Authorization: Basic base64(username:password) pre-emptively, with the credentials your DHL Express contact issued. Non-customers cannot get MyDHL credentials.',
      sources: [SOURCES.mydhlReference, SOURCES.mydhlNonCustomer],
    }];
  }
  if (PLACEHOLDER_BASIC.test(authorization)) return [placeholderNote(SOURCES.mydhlReference)];
  if (!decodeBasic(authorization)) {
    return [{
      ruleId: 'auth.mydhl-malformed-basic',
      severity: 'error',
      title: 'The Basic credential is malformed',
      detail: 'The Authorization header is not "Basic " followed by base64 of username:password.',
      fix: 'Build it as "Basic " + base64(username + ":" + password), with no line breaks.',
      sources: [SOURCES.mydhlReference],
    }];
  }
  return [];
};

/** Parcel DE Shipping: OAuth bearer (recommended), or Basic plus a dhl-api-key header. */
const parcelDeRules: Rule = ({ detection, headers }) => {
  if (detection.api !== 'parcel-de-shipping') return [];
  // The specification sets `security: []` on these two: the version check and label downloads.
  if (detection.operation === 'GET /' || detection.operation === 'GET /labels') return [];
  const authorization = headers.get('authorization') ?? '';
  if (/^Bearer\s+\S+/i.test(authorization)) return [];
  const placeholder = PLACEHOLDER_BASIC.test(authorization);
  if ((decodeBasic(authorization) || placeholder) && headers.has(API_KEY_HEADER)) {
    return [...(placeholder ? [placeholderNote(SOURCES.parcelDeReference)] : []), {
      ruleId: 'auth.parcel-de-basic',
      severity: 'warning',
      title: 'Basic authentication is being retired here',
      detail: 'Parcel DE Shipping still accepts Basic plus a dhl-api-key header, but DHL recommends an OAuth2 bearer token from the Parcel DE Authentication API.',
      fix: 'Get a token from the Parcel DE Authentication API and send Authorization: Bearer <token>.',
      sources: [SOURCES.parcelDeReference],
    }];
  }
  return [{
    ruleId: 'auth.parcel-de-missing',
    severity: 'error',
    title: 'No valid Parcel DE authentication',
    detail: 'DHL\'s reference page describes two ways to authenticate: an OAuth2 bearer token, or Basic credentials together with a dhl-api-key header. This request has neither complete.',
    fix: 'Send Authorization: Bearer <token> from the Parcel DE Authentication API. The sandbox works with the public sandbox login on the API reference page.',
    sources: [SOURCES.parcelDeReference],
  }];
};

export const authRules: Rule[] = [keyHeaderRules, basicRules, parcelDeRules];
