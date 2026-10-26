import { at, isRecord } from '../input.js';
import { SOURCES } from '../sources.js';
import type { Finding, Source } from '../types.js';
import type { Rule, RuleContext } from './context.js';
import { CREATE_SHIPMENT, validate, type Violation } from './schema.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const JSON_APIS = new Set(['mydhl', 'parcel-de-shipping', 'tracking', 'location-finder']);

/** Body checks for every JSON API (not the legacy XML ones). */
const jsonBodyRules: Rule = ({ method, headers, body, detection }) => {
  if (!JSON_APIS.has(detection.api) || !WRITE_METHODS.has(method.trim().toUpperCase())) return [];
  const findings: Finding[] = [];
  const reference = detection.api === 'parcel-de-shipping' ? SOURCES.parcelDeReference : SOURCES.mydhlReference;

  if (body.kind === 'none') {
    return [{
      ruleId: 'body.missing', severity: 'error', title: 'The request has no body',
      detail: `${method.toUpperCase()} requests to this API carry a JSON document.`,
      fix: 'Send the JSON request body described in the API reference.', sources: [reference],
    }];
  }
  if (body.hasBom) {
    findings.push({
      ruleId: 'body.bom', severity: 'error', title: 'The body starts with a byte order mark',
      detail: 'The JSON begins with an invisible U+FEFF character, usually added by an editor or a file saved as "UTF-8 with BOM". DHL\'s reference warns against it.',
      fix: 'Save or serialise the body as UTF-8 without BOM.', sources: [SOURCES.mydhlReference],
    });
  }
  if (body.kind === 'invalid') {
    findings.push({
      ruleId: 'body.invalid-json', severity: 'error', title: 'The body is not valid JSON', detail: body.error,
      fix: 'Build the body with a JSON serialiser rather than string concatenation.', sources: [reference],
    });
  } else if (!isRecord(body.value)) {
    findings.push({
      ruleId: 'body.not-object', severity: 'error', title: 'The body is not a JSON object',
      detail: `The body is ${body.value === null ? 'null' : Array.isArray(body.value) ? 'an array' : `a ${typeof body.value}`}. DHL's request bodies are JSON objects.`,
      fix: 'Send a single JSON object, e.g. { "plannedShippingDateAndTime": … }.', sources: [reference],
    });
  }
  const contentType = headers.get('content-type');
  if (!contentType?.toLowerCase().includes('application/json')) {
    findings.push({
      ruleId: 'body.content-type', severity: 'warning', title: 'Content-Type is not application/json',
      detail: contentType ? `The request says "${contentType}".` : 'The request has no Content-Type header.',
      fix: 'Send Content-Type: application/json.', sources: [reference],
    });
  }
  return findings;
};

/** DHL's validator writes paths as JSON pointers: `#/customerDetails/shipperDetails`. */
const pointer = (path: string) => (path ? `#/${path.replace(/\./g, '/')}` : '#');
const fieldName = (path: string) => path.split('.').filter((p) => !/^\d+$/.test(p)).pop() ?? path;
const keyPath = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** Turns a schema violation into a finding that quotes DHL's own validator message. */
function fromViolation(v: Violation): Finding {
  const mydhl: Source[] = [SOURCES.mydhlReference];
  switch (v.kind) {
    case 'required':
      return {
        ruleId: 'mydhl.required', severity: 'error', title: `Missing ${keyPath(v.path, v.key)}`,
        detail: `MyDHL API requires ${v.key} here. DHL answers "${pointer(v.path)}: required key [${v.key}] not found".`,
        fix: `Add ${keyPath(v.path, v.key)} to the request.`, path: keyPath(v.path, v.key), sources: mydhl,
      };
    case 'extraneous': {
      const singular = v.key === 'exportDeclaration' && v.path === 'content';
      return {
        ruleId: singular ? 'mydhl.export-declaration-name' : 'mydhl.unknown-field', severity: singular ? 'warning' : 'error',
        title: singular ? 'Specification 3.4.0 names this exportDeclarations' : `${keyPath(v.path, v.key)} is not a field of this object`,
        detail: singular
          ? 'The 3.4.0 schema defines content.exportDeclarations, an array, and does not allow other keys in content. The singular exportDeclaration belongs to the upload-invoice-data endpoints, although some of DHL\'s own example errors still show it.'
          : `The specification does not allow ${v.key} here, often a typo or wrong letter case. DHL answers "${pointer(v.path)}: extraneous key [${v.key}] is not permitted".`,
        fix: singular ? 'Send content.exportDeclarations: [ { lineItems, invoice, incoterm } ].' : `Check the spelling of ${v.key} against the API reference, or remove it.`,
        path: keyPath(v.path, v.key), sources: mydhl,
      };
    }
    case 'type':
      return {
        ruleId: 'mydhl.type', severity: 'error', title: `${v.path} must be a ${v.expected}`,
        detail: `${v.path} is ${v.actual === 'null' ? 'null' : `a ${v.actual}`}.${
          v.expected === 'string' && v.actual === 'number' ? ' Numbers such as account numbers and phone numbers are strings in MyDHL API, which also keeps leading zeros.' : ''}${
          v.expected === 'number' && v.actual === 'string' ? ' Quantities such as weights are JSON numbers, not quoted strings.' : ''}`,
        fix: `Send ${v.path} as a JSON ${v.expected}.`, path: v.path, sources: mydhl,
      };
    case 'maxLength': {
      const name = fieldName(v.path);
      return {
        ruleId: 'mydhl.max-length', severity: 'error', title: `${name} is longer than ${v.limit} characters`,
        detail: `${v.path} is ${v.actual} characters. DHL answers "${pointer(v.path)}: expected maxLength: ${v.limit}, actual: ${v.actual}".`,
        fix: /^addressLine[123]$/.test(name)
          ? 'Split the address across addressLine1, addressLine2 and addressLine3 (45 characters each).'
          : `Shorten it to ${v.limit} characters.`,
        path: v.path, sources: mydhl,
      };
    }
    case 'minLength':
      return {
        ruleId: v.actual === 0 ? 'mydhl.empty' : 'mydhl.min-length', severity: 'error',
        title: v.actual === 0 ? `${fieldName(v.path)} is an empty string` : `${fieldName(v.path)} is shorter than ${v.limit} characters`,
        detail: `${v.path} must be at least ${v.limit} character${v.limit === 1 ? '' : 's'} when present. DHL answers "${pointer(v.path)}: expected minLength: ${v.limit}, actual: ${v.actual}".`,
        fix: v.actual === 0 ? `Leave ${fieldName(v.path)} out of the JSON instead of sending "".` : `Send at least ${v.limit} characters.`,
        path: v.path, sources: mydhl,
      };
    case 'minimum':
      return {
        ruleId: 'mydhl.minimum', severity: 'error', title: `${fieldName(v.path)} must be at least ${v.limit}`,
        detail: `${v.path} is ${v.actual}.`, fix: `Send a value of ${v.limit} or more.`, path: v.path, sources: mydhl,
      };
    case 'enum':
      return {
        ruleId: 'mydhl.enum', severity: 'error', title: `"${v.actual}" is not allowed for ${fieldName(v.path)}`,
        detail: `${v.path} must be one of: ${v.allowed.join(', ')}. Values are case-sensitive.`,
        fix: `Use one of the listed values for ${fieldName(v.path)}.`, path: v.path, sources: mydhl,
      };
    case 'pattern':
      return {
        ruleId: 'mydhl.pattern', severity: 'error', title: `${fieldName(v.path)} has the wrong format`,
        detail: fieldName(v.path) === 'closeTime'
          ? `"${v.actual}" is not a 24-hour HH:MM time.`
          : fieldName(v.path) === 'description' ? 'The description starts with whitespace, which the specification forbids.' : `"${v.actual}" does not match the format the specification requires.`,
        fix: fieldName(v.path) === 'closeTime' ? 'Send the latest pickup time as "18:00".' : 'Fix the value as described.',
        path: v.path, sources: mydhl,
      };
    case 'minItems':
    case 'maxItems':
      return {
        ruleId: 'mydhl.item-count', severity: 'error',
        title: `${v.path} has ${v.actual} item${v.actual === 1 ? '' : 's'}`,
        detail: `${v.path} takes ${v.kind === 'minItems' ? 'at least' : 'at most'} ${v.limit}. DHL answers "${pointer(v.path)}: expected ${v.kind === 'minItems' ? 'minimum' : 'maximum'} item count: ${v.limit}, found: ${v.actual}".`,
        fix: v.path === 'accounts' ? 'Send between one and three accounts, including the shipper account.' : `Send ${v.kind === 'minItems' ? 'at least' : 'at most'} ${v.limit}.`,
        path: v.path, sources: mydhl,
      };
  }
}

/** `2026-10-27T10:00:00GMT+08:00`; DHL's own 998 message shows a space before GMT, so both pass. */
const MYDHL_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}) ?GMT([+-])(\d{2}):(\d{2})$/;
const DAY = 86_400_000;

interface PlannedTime { utc: number; localDate: string; weekday: number; minutesOfDay: number }

/** Parses and range-checks DHL's date format; undefined when it is not a real moment. */
function parsePlanned(value: string): PlannedTime | undefined {
  const match = MYDHL_DATE.exec(value);
  if (!match) return undefined;
  const [y, mo, d, h, mi, s, , oh, om] = match.slice(1).map(Number) as [number, number, number, number, number, number, number, number, number];
  const local = Date.UTC(y, mo - 1, d, h, mi, s);
  const asDate = new Date(local);
  const roundTrips = asDate.getUTCFullYear() === y && asDate.getUTCMonth() === mo - 1 && asDate.getUTCDate() === d
    && h < 24 && mi < 60 && s < 60;
  if (!roundTrips || oh > 14 || om > 59 || oh * 60 + om > 14 * 60) return undefined;
  const offset = (match[7] === '-' ? -1 : 1) * (oh * 60 + om);
  return { utc: local - offset * 60_000, localDate: value.slice(0, 10), weekday: asDate.getUTCDay(), minutesOfDay: h * 60 + mi };
}

/** Countries whose weekend is Friday and Saturday; everywhere else it is Saturday and Sunday. */
const FRIDAY_SATURDAY = new Set(['SA', 'KW', 'QA', 'BH', 'OM', 'IL', 'EG', 'JO', 'IQ', 'YE', 'SY', 'DZ', 'LY', 'SD']);

function dateFindings(value: unknown, now: Date, country: unknown): Finding[] {
  if (typeof value !== 'string' || value === '') return [];
  const path = 'plannedShippingDateAndTime';
  const planned = parsePlanned(value);
  if (!planned) {
    const shaped = MYDHL_DATE.test(value);
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value);
    return [{
      ruleId: 'mydhl.date-format', severity: 'error', title: 'plannedShippingDateAndTime is not a valid DHL date',
      detail: shaped
        ? `"${value}" has the right shape, but no such date, time or offset exists (offsets go up to GMT+14:00).`
        : iso
          ? `"${value}" is ISO 8601. MyDHL API wants its own format, e.g. 2026-10-27T10:00:00GMT+08:00, and answers 998 "ShipTimeStamp is not well formatted" otherwise.`
          : `"${value}" does not match YYYY-MM-DDTHH:MM:SSGMT+HH:MM. DHL answers 998 "ShipTimeStamp is not well formatted".`,
      fix: 'Send the local shipping time with "GMT" and the UTC offset, no milliseconds and no "Z": 2026-10-27T10:00:00GMT+08:00.',
      path, sources: [SOURCES.mydhlReference, SOURCES.dateFormatFix],
    }];
  }
  const findings: Finding[] = [];
  if (planned.utc < now.getTime()) {
    findings.push({
      ruleId: 'mydhl.date-past', severity: 'error', title: 'The planned shipping time is in the past',
      detail: `${value} has already passed. The specification says the date "should not be in the past or more than 10 days in the future".`,
      fix: 'Send a future local time with its UTC offset. A past value is usually a client clock or offset bug.', path, sources: [SOURCES.mydhlReference],
    });
  } else if (planned.utc - now.getTime() > 10 * DAY) {
    findings.push({
      ruleId: 'mydhl.date-too-far', severity: 'error', title: 'The planned shipping date is more than 10 days ahead',
      detail: `${value} is ${Math.floor((planned.utc - now.getTime()) / DAY)} days from now. The specification allows at most 10 days.`,
      fix: 'Create the shipment closer to the shipping date.', path, sources: [SOURCES.mydhlReference],
    });
  }
  const weekend = typeof country === 'string' && FRIDAY_SATURDAY.has(country.toUpperCase()) ? [5, 6] : [6, 0];
  if (weekend.includes(planned.weekday)) {
    const day = ['Sunday', '', '', '', '', 'Friday', 'Saturday'][planned.weekday] ?? '';
    findings.push({
      ruleId: 'mydhl.date-weekend', severity: 'info', title: `The planned shipping date is a ${day}`,
      detail: `${planned.localDate} is a ${day}, a weekend day where the shipment starts. If no product picks up then, DHL answers 996 "The requested product(s) not available for the requested pickup date". Public holidays, and regional weekends such as Friday–Saturday in some Malaysian states, cause the same error and are not checked here.`,
      fix: 'Ask GET /products for this date and origin; if nothing is offered, move to the next working day.',
      path, sources: [SOURCES.shippyProErrors, SOURCES.mydhlReference],
    });
  }
  return findings;
}

function shipmentRules(context: RuleContext): Finding[] {
  const { detection, body, headers, url } = context;
  if (detection.api !== 'mydhl' || detection.operation !== 'POST /shipments' || body.kind !== 'json' || !isRecord(body.value)) return [];
  const shipment = body.value;
  const mydhl = [SOURCES.mydhlReference];

  const findings = validate(shipment, CREATE_SHIPMENT).map(fromViolation);
  findings.push(...dateFindings(shipment.plannedShippingDateAndTime, context.now, at(shipment, 'customerDetails.shipperDetails.postalAddress.countryCode')));

  for (const party of ['shipperDetails', 'receiverDetails'] as const) {
    const country = at(shipment, `customerDetails.${party}.postalAddress.countryCode`);
    if (typeof country === 'string' && country.length === 2 && !/^[A-Z]{2}$/.test(country)) {
      findings.push({
        ruleId: 'mydhl.country-code', severity: 'warning', title: `countryCode "${country}" is not uppercase`,
        detail: 'The specification only fixes the length at 2, but its examples and DHL\'s reference data use uppercase ISO 3166-1 alpha-2 codes (MY, SG, DE).',
        fix: 'Send the country code in uppercase.', path: `customerDetails.${party}.postalAddress.countryCode`, sources: mydhl,
      });
    }
  }

  const accounts = shipment.accounts;
  if (Array.isArray(accounts) && accounts.length > 0 && !accounts.some((account) => at(account, 'typeCode') === 'shipper')) {
    findings.push({
      ruleId: 'mydhl.no-shipper-account', severity: 'warning', title: 'No account with typeCode "shipper"',
      detail: 'Shipments are normally created against a shipper account linked to your credentials; payer and duties-taxes accounts only add to it. Account problems surface as 8007, "The Shipper Account is invalid".',
      fix: 'Add { "typeCode": "shipper", "number": "<your account>" } to accounts.', path: 'accounts', sources: mydhl,
    });
  }

  if (at(shipment, 'customerDetails.shipperDetails.postalAddress.countryCode') === 'US'
    && at(shipment, 'customerDetails.receiverDetails.postalAddress.countryCode') === 'US') {
    findings.push({
      ruleId: 'mydhl.us-domestic', severity: 'error', title: 'DHL Express does not ship within the US',
      detail: 'Shipper and receiver are both in the US. DHL support confirms MyDHL API cannot create US domestic shipments.',
      fix: 'Use another carrier for US domestic parcels, or check the addresses.', path: 'customerDetails', sources: [SOURCES.mydhlUsDomestic],
    });
  }

  const content = shipment.content;
  if (isRecord(content) && content.isCustomsDeclarable === true) {
    if (content.declaredValue === undefined || content.declaredValueCurrency === undefined) {
      findings.push({
        ruleId: 'mydhl.customs-value', severity: 'warning', title: 'A dutiable shipment without a declared value',
        detail: 'isCustomsDeclarable is true, but content.declaredValue or content.declaredValueCurrency is missing. The schema does not require them, but customs clearance needs the value of the goods.',
        fix: 'Add declaredValue (a number) and declaredValueCurrency (ISO 4217, e.g. "MYR").', path: 'content', sources: mydhl,
      });
    }
    if (content.exportDeclarations === undefined && content.exportDeclaration === undefined) {
      findings.push({
        ruleId: 'mydhl.export-declaration', severity: 'error', title: 'No export declaration for a dutiable shipment',
        detail: 'The specification says: "If the shipment is dutiable, exportDeclarations element must be provided." Integrators report error 7121 for this case.',
        fix: 'Add content.exportDeclarations: [ { lineItems, invoice, incoterm } ], or use paperless trade with an uploaded invoice.',
        path: 'content.exportDeclarations', sources: [SOURCES.mydhlReference, SOURCES.shippyProErrors],
      });
    }
  }

  const closeTime = at(shipment, 'pickup.closeTime');
  const planned = typeof shipment.plannedShippingDateAndTime === 'string' ? parsePlanned(shipment.plannedShippingDateAndTime) : undefined;
  const close = typeof closeTime === 'string' ? /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/.exec(closeTime) : null;
  if (planned && close && at(shipment, 'pickup.isRequested') === true && planned.minutesOfDay > Number(close[1]) * 60 + Number(close[2])) {
    findings.push({
      ruleId: 'mydhl.pickup-window', severity: 'warning', title: 'The shipment is ready after the pickup close time',
      detail: `The planned time is later in the day than pickup.closeTime ${close[0]}. Integrators report 202115 "Ready time cannot be greater than close time" for this case.`,
      fix: 'Plan the shipment before the close time, or move the close time later.', path: 'pickup.closeTime',
      sources: [SOURCES.shippyProErrors],
    });
  }

  if (!headers.has('x-version')) {
    findings.push({
      ruleId: 'mydhl.x-version', severity: 'warning', title: 'No x-version header',
      detail: 'The specification marks the x-version header as required for POST /shipments, with the value 3.4.0 ("do not change this field value").',
      fix: 'Send x-version: 3.4.0.', sources: mydhl,
    });
  }
  if (url && url.searchParams.get('validateDataOnly')?.toLowerCase() !== 'true') {
    findings.push({
      ruleId: 'mydhl.validate-hint', severity: 'info', title: 'You can validate this shipment without creating it',
      detail: 'POST /shipments?validateDataOnly=true runs DHL\'s checks and creates nothing.',
      fix: 'Add ?validateDataOnly=true while you develop, and drop it to create shipments.', sources: mydhl,
    });
  }
  return findings;
}

/** Parcel DE: `?validate=true` checks an order without creating a label. */
const parcelDeValidateHint: Rule = ({ detection, url }) => {
  if (detection.api !== 'parcel-de-shipping' || !url || detection.operation !== 'POST /orders') return [];
  if (url.searchParams.get('validate')?.toLowerCase() === 'true') return [];
  return [{
    ruleId: 'parcel-de.validate', severity: 'info', title: 'You can validate this order without creating a label',
    detail: 'POST /orders?validate=true checks the request against the schema and then against DHL\'s backend, and creates nothing.',
    fix: 'Add ?validate=true while you develop, and drop it to create labels.', sources: [SOURCES.parcelDeReference],
  }];
};

export const payloadRules: Rule[] = [jsonBodyRules, shipmentRules, parcelDeValidateHint];
