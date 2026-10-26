import { describe, expect, it } from 'vitest';
import { diagnose, type Finding } from '../src/index.js';
import { NOW, shipmentRequest, validShipment } from './fixtures.js';

const run = (body: unknown, overrides = {}) => diagnose(shipmentRequest(body, overrides), { now: NOW }).findings;
const ids = (findings: Finding[]) => findings.map((f) => f.ruleId);
const errors = (findings: Finding[]) => findings.filter((f) => f.severity !== 'info');
const withChange = (change: (shipment: Record<string, any>) => void) => {
  const shipment = validShipment() as Record<string, any>;
  change(shipment);
  return run(shipment);
};
const find = (findings: Finding[], ruleId: string) => findings.find((f) => f.ruleId === ruleId);

describe('a correct MyDHL shipment request', () => {
  it('has only the test-environment note', () => {
    expect(ids(run(validShipment()))).toEqual(['env.mydhl-test']);
  });

  it('suggests validateDataOnly and asks for x-version when they are missing', () => {
    const findings = run(validShipment(), {
      url: 'https://express.api.dhl.com/mydhlapi/test/shipments',
      headers: { Authorization: `Basic ${btoa('u:p')}`, 'Content-Type': 'application/json' },
    });
    expect(ids(findings)).toEqual(['mydhl.x-version', 'env.mydhl-test', 'mydhl.validate-hint']);
  });
});

describe('MyDHL authentication', () => {
  it('requires Basic auth, and explains when DHL-API-Key was sent instead', () => {
    const findings = run(validShipment(), { headers: { 'DHL-API-Key': 'k', 'Content-Type': 'application/json', 'x-version': '3.4.0' } });
    expect(find(findings, 'auth.mydhl-missing-basic')?.detail).toContain('Shipment Tracking');
  });

  it('rejects a Basic value that is not base64 of user:password', () => {
    const headers = { Authorization: `Basic ${btoa('no-colon')}`, 'Content-Type': 'application/json', 'x-version': '3.4.0' };
    expect(ids(run(validShipment(), { headers }))).toContain('auth.mydhl-malformed-basic');
  });

  it('accepts a placeholder such as Basic <credentials>', () => {
    const headers = { Authorization: 'Basic <credentials>', 'Content-Type': 'application/json', 'x-version': '3.4.0' };
    const findings = ids(run(validShipment(), { headers }));
    expect(findings).not.toContain('auth.mydhl-malformed-basic');
    // Still noted: the brackets left in a real request make DHL answer 401.
    expect(findings).toContain('auth.placeholder');
    // A half-written placeholder is still caught.
    const broken = { ...headers, Authorization: 'Basic <credentials' };
    expect(ids(run(validShipment(), { headers: broken }))).toContain('auth.mydhl-malformed-basic');
  });

  it('does not ask for credentials on the mock server', () => {
    const findings = run(validShipment(), {
      url: 'https://api-mock.dhl.com/mydhlapi/shipments?validateDataOnly=true',
      headers: { 'Content-Type': 'application/json', 'x-version': '3.4.0' },
    });
    expect(ids(findings)).toEqual(['env.mydhl-mock']);
  });
});

describe('body', () => {
  it('rejects a byte order mark', () => {
    expect(ids(run('﻿' + JSON.stringify(validShipment())))).toContain('body.bom');
  });

  it('rejects invalid JSON and a missing body', () => {
    expect(ids(run('{ "productCode": "P", }'))).toContain('body.invalid-json');
    expect(ids(run(''))).toContain('body.missing');
  });

  it.each(['[]', 'null', '"text"', '42', 'true', '[{}]'])('rejects the non-object body %s', (body) => {
    expect(ids(run(body))).toContain('body.not-object');
  });

  it('warns about a missing Content-Type', () => {
    expect(ids(run(validShipment(), { headers: { Authorization: `Basic ${btoa('u:p')}`, 'x-version': '3.4.0' } }))).toContain('body.content-type');
  });
});

describe('plannedShippingDateAndTime', () => {
  const at = (value: string) => withChange((s) => { s.plannedShippingDateAndTime = value; });

  it('explains ISO 8601 dates as the cause of 998', () => {
    const detail = find(at('2026-10-27T02:00:00.000Z'), 'mydhl.date-format')?.detail;
    expect(detail).toContain('ISO 8601');
    expect(detail).toContain('998');
  });

  it('accepts the spaced form DHL\'s own 998 message shows', () => {
    expect(ids(at('2026-10-27T10:00:00 GMT+08:00'))).toEqual(['env.mydhl-test']);
  });

  it.each(['2026-10-27T25:61:61GMT+08:00', '2026-13-45T10:00:00GMT+08:00', '2026-10-27T10:00:00GMT+25:00', '2026-02-30T10:00:00GMT+08:00'])(
    'rejects the impossible value %s', (value) => {
      expect(find(at(value), 'mydhl.date-format')?.detail).toContain('no such date');
    },
  );

  it('rejects a time in the past, honouring the offset', () => {
    // 08:59 in KL is 00:59 UTC, one minute before NOW.
    expect(ids(at('2026-10-26T08:59:00GMT+08:00'))).toContain('mydhl.date-past');
    expect(ids(at('2026-10-26T09:01:00GMT+08:00'))).not.toContain('mydhl.date-past');
  });

  it('rejects a date more than 10 days ahead', () => {
    expect(ids(at('2026-11-05T09:00:00GMT+08:00'))).not.toContain('mydhl.date-too-far');
    expect(ids(at('2026-11-06T10:00:00GMT+08:00'))).toContain('mydhl.date-too-far');
  });

  it('notes a weekend date as a possible 996, using the shipper country\'s weekend', () => {
    const saturday = find(at('2026-10-31T10:00:00GMT+08:00'), 'mydhl.date-weekend');
    expect(saturday).toMatchObject({ severity: 'info' });
    expect(saturday?.sources[0]?.official).toBe(false);
    expect(ids(at('2026-10-30T10:00:00GMT+08:00'))).not.toContain('mydhl.date-weekend');

    const fromRiyadh = (date: string) => withChange((s) => {
      s.customerDetails.shipperDetails.postalAddress.countryCode = 'SA';
      s.plannedShippingDateAndTime = date;
    });
    expect(ids(fromRiyadh('2026-10-30T10:00:00GMT+03:00'))).toContain('mydhl.date-weekend');
    expect(ids(fromRiyadh('2026-11-01T10:00:00GMT+03:00'))).not.toContain('mydhl.date-weekend');
  });
});

describe('fields, from the specification', () => {
  it('names each missing top-level field in DHL\'s words', () => {
    const findings = run({ productCode: 'P' }).filter((f) => f.ruleId === 'mydhl.required');
    expect(findings.map((f) => f.path)).toEqual(['plannedShippingDateAndTime', 'pickup', 'accounts', 'customerDetails', 'content']);
    expect(findings[0]?.detail).toContain('#: required key [plannedShippingDateAndTime] not found');
  });

  it('names a missing countryCode with its full path', () => {
    const finding = find(withChange((s) => { delete s.customerDetails.receiverDetails.postalAddress.countryCode; }), 'mydhl.required');
    expect(finding?.path).toBe('customerDetails.receiverDetails.postalAddress.countryCode');
    expect(finding?.detail).toContain('#/customerDetails/receiverDetails/postalAddress: required key [countryCode] not found');
  });

  it('quotes DHL\'s validator message for a 46-character address line', () => {
    const finding = find(withChange((s) => { s.customerDetails.shipperDetails.postalAddress.addressLine1 = 'x'.repeat(46); }), 'mydhl.max-length');
    expect(finding?.detail).toContain('#/customerDetails/shipperDetails/postalAddress/addressLine1: expected maxLength: 45, actual: 46');
    expect(finding?.fix).toContain('addressLine2');
  });

  it('allows exactly 45 characters, counted as code points', () => {
    expect(ids(withChange((s) => { s.customerDetails.shipperDetails.postalAddress.cityName = 'x'.repeat(45); }))).toEqual(['env.mydhl-test']);
    expect(ids(withChange((s) => { s.customerDetails.shipperDetails.postalAddress.cityName = '🏙'.repeat(45); }))).toEqual(['env.mydhl-test']);
  });

  it('accepts an empty postcode, which the specification allows', () => {
    expect(ids(withChange((s) => { s.customerDetails.receiverDetails.postalAddress.postalCode = ''; }))).toEqual(['env.mydhl-test']);
  });

  it.each(['addressLine2', 'countyName', 'provinceName', 'countryName'])('flags an empty optional %s', (field) => {
    const finding = find(withChange((s) => { s.customerDetails.shipperDetails.postalAddress[field] = ''; }), 'mydhl.empty');
    expect(finding?.detail).toContain('expected minLength: 1, actual: 0');
  });

  it('flags an empty description and empty optional contact fields', () => {
    expect(ids(withChange((s) => { s.content.description = ''; }))).toContain('mydhl.empty');
    expect(ids(withChange((s) => { s.customerDetails.shipperDetails.contactInformation.email = ''; }))).toContain('mydhl.empty');
  });

  it.each([
    ['productCode', (s: Record<string, any>) => { s.productCode = 7; }, 'string'],
    ['phone', (s: Record<string, any>) => { s.customerDetails.shipperDetails.contactInformation.phone = 60300000000; }, 'string'],
    ['closeTime', (s: Record<string, any>) => { s.pickup.closeTime = 1800; }, 'string'],
    ['isCustomsDeclarable', (s: Record<string, any>) => { s.content.isCustomsDeclarable = 'true'; }, 'boolean'],
    ['packages', (s: Record<string, any>) => { s.content.packages = {}; }, 'array'],
    ['customerDetails', (s: Record<string, any>) => { s.customerDetails = null; }, 'object'],
    ['dimensions', (s: Record<string, any>) => { s.content.packages[0].dimensions = null; }, 'object'],
  ])('flags a wrong type for %s', (_name, change, expected) => {
    expect(find(withChange(change), 'mydhl.type')?.title).toContain(`must be a ${expected}`);
  });

  it('flags a lowercase country code as a warning and a three-letter one as an error', () => {
    expect(find(withChange((s) => { s.customerDetails.receiverDetails.postalAddress.countryCode = 'sg'; }), 'mydhl.country-code')?.severity).toBe('warning');
    expect(ids(withChange((s) => { s.customerDetails.receiverDetails.postalAddress.countryCode = 'SGP'; }))).toContain('mydhl.max-length');
  });

  it('flags a misspelt top-level key', () => {
    const finding = find(withChange((s) => { s.productcode = 'P'; }), 'mydhl.unknown-field');
    expect(finding?.detail).toContain('extraneous key [productcode] is not permitted');
  });

  it('flags pickup without isRequested', () => {
    expect(find(withChange((s) => { delete s.pickup.isRequested; }), 'mydhl.required')?.path).toBe('pickup.isRequested');
  });
});

describe('accounts', () => {
  it('explains an account number sent as a JSON number', () => {
    expect(find(withChange((s) => { s.accounts[0].number = 123456789; }), 'mydhl.type')?.detail).toContain('leading zeros');
  });

  it('flags an unknown typeCode, and a missing shipper account', () => {
    expect(ids(withChange((s) => { s.accounts[0].typeCode = 'payor'; }))).toEqual(expect.arrayContaining(['mydhl.enum', 'mydhl.no-shipper-account']));
  });

  it('requires one to three accounts', () => {
    expect(find(withChange((s) => { s.accounts = []; }), 'mydhl.item-count')?.detail).toContain('expected minimum item count: 1, found: 0');
    const four = Array.from({ length: 4 }, () => ({ typeCode: 'shipper', number: '1' }));
    expect(ids(withChange((s) => { s.accounts = four; }))).toContain('mydhl.item-count');
  });
});

describe('route, content and pickup', () => {
  it('rejects US to US shipments', () => {
    expect(ids(withChange((s) => {
      s.customerDetails.shipperDetails.postalAddress.countryCode = 'US';
      s.customerDetails.receiverDetails.postalAddress.countryCode = 'US';
    }))).toContain('mydhl.us-domestic');
  });

  it('requires exportDeclarations for dutiable shipments', () => {
    const findings = withChange((s) => { s.content.isCustomsDeclarable = true; s.content.declaredValue = 100; s.content.declaredValueCurrency = 'MYR'; });
    expect(ids(errors(findings))).toEqual(['mydhl.export-declaration']);
    expect(find(findings, 'mydhl.export-declaration')?.fix).toContain('exportDeclarations');
  });

  it('warns that 3.4.0 names the field exportDeclarations, and accepts the plural', () => {
    const singular = withChange((s) => { s.content.isCustomsDeclarable = true; s.content.declaredValue = 1; s.content.declaredValueCurrency = 'MYR'; s.content.exportDeclaration = {}; });
    expect(ids(errors(singular))).toEqual(['mydhl.export-declaration-name']);
    const plural = withChange((s) => { s.content.isCustomsDeclarable = true; s.content.declaredValue = 1; s.content.declaredValueCurrency = 'MYR'; s.content.exportDeclarations = [{}]; });
    expect(errors(plural)).toEqual([]);
  });

  it('flags a weight sent as a string, and incomplete dimensions', () => {
    const findings = withChange((s) => { s.content.packages[0] = { weight: '1.5', dimensions: { length: 10 } }; });
    expect(find(findings, 'mydhl.type')?.detail).toContain('quoted strings');
    expect(findings.filter((f) => f.ruleId === 'mydhl.required').map((f) => f.path)).toEqual(
      ['content.packages.0.dimensions.width', 'content.packages.0.dimensions.height'],
    );
  });

  it('flags a description with leading whitespace, and a bad unit', () => {
    expect(ids(withChange((s) => { s.content.description = ' Documents'; s.content.unitOfMeasurement = 'kg'; }))).toEqual(
      expect.arrayContaining(['mydhl.pattern', 'mydhl.enum']),
    );
  });

  it('flags a closeTime that is not HH:MM, and a product code that is too long', () => {
    expect(ids(withChange((s) => { s.pickup.closeTime = '6pm'; s.productCode = 'EXPRESS'; }))).toEqual(
      expect.arrayContaining(['mydhl.pattern', 'mydhl.max-length']),
    );
  });

  it('warns when a requested pickup is ready after its close time (202115)', () => {
    const late = withChange((s) => { s.pickup = { isRequested: true, closeTime: '09:00' }; });
    expect(ids(late)).toContain('mydhl.pickup-window');
    expect(ids(withChange((s) => { s.pickup = { isRequested: true, closeTime: '18:00' }; }))).not.toContain('mydhl.pickup-window');
  });
});

it('only checks POST /shipments itself, not its sub-resources', () => {
  const findings = run({}, { url: 'https://express.api.dhl.com/mydhlapi/test/shipments/123/tracking', method: 'POST' });
  expect(ids(findings)).not.toContain('mydhl.required');
  expect(ids(findings)).toContain('endpoint.method');
});

it('sorts errors before warnings before notes', () => {
  const findings = withChange((s) => { s.plannedShippingDateAndTime = '2026-10-31T10:00:00GMT+08:00'; s.productCode = 'EXPRESS'; s.content.isCustomsDeclarable = true; s.content.exportDeclarations = [{}]; });
  const order = findings.map((f) => f.severity);
  expect(order).toEqual([...order].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)));
  expect(new Set(order)).toEqual(new Set(['error', 'warning', 'info']));
});
