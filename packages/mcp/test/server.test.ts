import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import type { FetchLike } from '../src/dhl.js';
import { createServer } from '../src/server.js';

interface Call { url: string; init: RequestInit }

let client: Client | undefined;

/** Connects a real MCP client to the server in memory; `fetch` stands in for DHL. */
async function connect(config: Config, fetch?: FetchLike): Promise<Client> {
  const server = createServer({ config, ...(fetch ? { fetch } : {}) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

afterEach(async () => {
  await client?.close();
  client = undefined;
});

const text = (res: unknown): string => ((res as CallToolResult).content[0] as { text: string }).text;

function dhl(status: number, body: string, calls: Call[] = []): FetchLike {
  return (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } }));
  };
}

describe('offline tools', () => {
  it('lists the tools, read-only, with live validation only when MyDHL credentials are set', async () => {
    const plain = await connect(loadConfig({}));
    const { tools } = await plain.listTools();
    expect(tools.map((t) => t.name)).toEqual(['diagnose_request', 'explain_error', 'search_known_errors', 'track_shipment']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    await plain.close();

    const withMydhl = await connect(loadConfig({ MYDHL_USERNAME: 'u', MYDHL_PASSWORD: 'p' }));
    expect((await withMydhl.listTools()).tools.map((t) => t.name)).toContain('validate_mydhl_shipment');
  });

  it('diagnoses a request', async () => {
    const c = await connect(loadConfig({}));
    const res = await c.callTool({ name: 'diagnose_request', arguments: {
      method: 'GET',
      url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186',
      headers: { Authorization: 'Bearer <key>' },
    } });
    expect(text(res)).toContain('API: Shipment Tracking – Unified');
    expect(text(res)).toMatch(/1\. \[error\] No DHL-API-Key header/);
    expect((res.structuredContent as { findings: unknown[] }).findings.length).toBeGreaterThan(0);
  });

  it('explains an error with the request that caused it', async () => {
    const c = await connect(loadConfig({}));
    const res = await c.callTool({ name: 'explain_error', arguments: {
      status: 400,
      body: '{"detail":"998: ShipTimeStamp is not well formatted.","status":"400","instance":"/expressapi/shipments"}',
      request: { method: 'POST', url: 'https://express.api.dhl.com/mydhlapi/test/shipments' },
    } });
    expect(text(res)).toContain('Error codes: 998');
    expect(text(res)).toContain("Planned shipping time is not in DHL's format (id mydhl.998-date)");
  });

  it('searches the catalogue by code and by API', async () => {
    const c = await connect(loadConfig({}));
    const byCode = await c.callTool({ name: 'search_known_errors', arguments: { query: '7121' } });
    expect((byCode.structuredContent as { count: number }).count).toBe(1);
    const byApi = await c.callTool({ name: 'search_known_errors', arguments: { api: 'parcel-de-shipping' } });
    const ids = (byApi.structuredContent as { entries: { id: string }[] }).entries.map((e) => e.id);
    expect(ids).toContain('parcel-de.401');
    expect(ids).not.toContain('mydhl.401');
  });

  it('serves the catalogue as a resource, with regex patterns as text', async () => {
    const c = await connect(loadConfig({}));
    const { contents } = await c.readResource({ uri: 'integration-doctor://catalogue' });
    const entries = JSON.parse((contents[0] as { text: string }).text) as { id: string; pattern?: string; patternFlags?: string }[];
    expect(entries.find((e) => e.id === 'mydhl.998-date')).toMatchObject({ patternFlags: 'i' });
  });

  it('accepts a JSON body as an object and a code as a number, as assistants often send them', async () => {
    const c = await connect(loadConfig({}));
    const diagnosed = await c.callTool({ name: 'diagnose_request', arguments: {
      method: 'POST',
      url: 'https://express.api.dhl.com/mydhlapi/test/shipments',
      headers: { Authorization: 'Basic <credentials>', 'Content-Type': 'application/json' },
      body: { plannedShippingDateAndTime: '2026-11-02T10:00:00Z', productCode: 'P' },
    } });
    expect(text(diagnosed)).toContain('plannedShippingDateAndTime is not a valid DHL date');
    const searched = await c.callTool({ name: 'search_known_errors', arguments: { query: 8007 } });
    expect((searched.structuredContent as { count: number }).count).toBe(1);
  });

  it('rejects invalid input before anything runs', async () => {
    const c = await connect(loadConfig({}));
    const res = await c.callTool({ name: 'explain_error', arguments: { status: 42 } });
    expect(res.isError).toBe(true);
  });
});

describe('track_shipment', () => {
  it('uses the demo-key when no key is configured', async () => {
    const calls: Call[] = [];
    const c = await connect(loadConfig({}), dhl(200, '{"shipments":[{"id":"1"}]}', calls));
    const res = await c.callTool({ name: 'track_shipment', arguments: { trackingNumber: '00340434292135100186', service: 'express' } });
    expect(calls[0]?.url).toBe('https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186&service=express');
    expect((calls[0]?.init.headers as Record<string, string>)['DHL-API-Key']).toBe('demo-key');
    expect(text(res)).toContain('DHL answered HTTP 200.');
    expect(text(res)).toContain('demo-key returns mocked data');
    expect((res.structuredContent as { response: { headers: object } }).response.headers).not.toHaveProperty('set-cookie');
  });

  it('sends the key from DHL_API_KEY but never shows it', async () => {
    const calls: Call[] = [];
    const secret = 'Sup3rSecretKeyValue9876';
    const c = await connect(loadConfig({ DHL_API_KEY: secret }), dhl(401, '{"status":401,"title":"Unauthorized","detail":"Unauthorized for given resource."}', calls));
    const res = await c.callTool({ name: 'track_shipment', arguments: { trackingNumber: '00340434292135100186' } });
    expect((calls[0]?.init.headers as Record<string, string>)['DHL-API-Key']).toBe(secret);
    const everything = JSON.stringify(res);
    expect(everything).not.toContain(secret);
    expect(everything).toContain('ending 9876');
    expect(text(res)).toContain('unified.401-not-for-resource');
  });

  it('paces calls to one every 5 seconds', async () => {
    const c = await connect(loadConfig({}), dhl(200, '{}'));
    await c.callTool({ name: 'track_shipment', arguments: { trackingNumber: '00340434292135100186' } });
    const second = await c.callTool({ name: 'track_shipment', arguments: { trackingNumber: '00340434292135100186' } });
    expect(second.isError).toBe(true);
    expect(text(second)).toMatch(/Wait \d s and try again/);
  });

  it('reports a network failure as a tool error', async () => {
    const c = await connect(loadConfig({}), () => Promise.reject(new TypeError('fetch failed')));
    const res = await c.callTool({ name: 'track_shipment', arguments: { trackingNumber: '00340434292135100186' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe('DHL did not answer: fetch failed');
  });

  it('rejects tracking numbers that could alter the query', async () => {
    const calls: Call[] = [];
    const c = await connect(loadConfig({}), dhl(200, '{}', calls));
    const res = await c.callTool({ name: 'track_shipment', arguments: { trackingNumber: '1&service=x' } });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('validate_mydhl_shipment', () => {
  it('always sends validateDataOnly=true with Basic auth and x-version, and hides the password', async () => {
    const calls: Call[] = [];
    const c = await connect(
      loadConfig({ MYDHL_USERNAME: 'apiUser', MYDHL_PASSWORD: 'p4ssw0rd-secret' }),
      dhl(400, '{"instance":"/expressapi/shipments","detail":"Multiple problems found, see Additional Details","status":"400","additionalDetails":["#/customerDetails/shipperDetails/postalAddress: required key [countryCode] not found"]}', calls),
    );
    const res = await c.callTool({ name: 'validate_mydhl_shipment', arguments: { body: '{"productCode":"P"}' } });
    expect(calls[0]?.url).toBe('https://express.api.dhl.com/mydhlapi/test/shipments?validateDataOnly=true');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa('apiUser:p4ssw0rd-secret')}`);
    expect(headers['x-version']).toBe('3.4.0');
    const everything = JSON.stringify(res);
    expect(everything).not.toContain('p4ssw0rd-secret');
    expect(everything).not.toContain(btoa('apiUser:p4ssw0rd-secret'));
    expect(text(res)).toContain('DHL answered HTTP 400.');
    expect(text(res)).toContain('Field: customerDetails.shipperDetails.postalAddress.countryCode');
    expect(text(res)).toMatch(/\[error\] Missing customerDetails/);
  });
});

describe('hostile configuration and responses', () => {
  it('refuses base URLs that could drop validateDataOnly or carry credentials, without echoing them', () => {
    const creds = { MYDHL_USERNAME: 'apiUser', MYDHL_PASSWORD: 'p4ssw0rd-secret' };
    for (const base of [
      'https://express.api.dhl.com/mydhlapi/test/shipments#',
      'https://express.api.dhl.com/mydhlapi/test?validateDataOnly=false&x=',
      'https://u:SECRETPW@express.api.dhl.com/mydhlapi/test',
    ]) {
      let message = '';
      try {
        loadConfig({ ...creds, MYDHL_BASE_URL: base });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/MYDHL_BASE_URL must not/);
      expect(message).not.toContain('SECRETPW');
    }
    expect(() => loadConfig({ DHL_TRACKING_URL: 'https//x:PW@host' })).toThrow('DHL_TRACKING_URL is not a valid URL.');
  });

  it('keeps validateDataOnly=true on a base URL with a trailing slash or extra path', async () => {
    const calls: Call[] = [];
    const c = await connect(loadConfig({ MYDHL_USERNAME: 'apiUser', MYDHL_PASSWORD: 'p4ssw0rd-secret', MYDHL_BASE_URL: 'https://express.api.dhl.com/mydhlapi/' }), dhl(200, '{}', calls));
    await c.callTool({ name: 'validate_mydhl_shipment', arguments: { body: '{}' } });
    expect(calls[0]?.url).toBe('https://express.api.dhl.com/mydhlapi/shipments?validateDataOnly=true');
  });

  it('scrubs credentials that DHL echoes back in a body, headers or an error', async () => {
    const key = 'Sup3rSecretKeyValue9876';
    const basic = btoa('apiUser:p4ssw0rd-secret');
    const echo: FetchLike = (_url, init) => Promise.resolve(new Response(
      JSON.stringify({ status: 401, title: 'Unauthorized', detail: `Rejected headers: ${JSON.stringify(init.headers)}` }),
      { status: 401, headers: { 'content-type': 'application/json', 'x-correlation-id': key } },
    ));
    const c = await connect(loadConfig({ DHL_API_KEY: key, MYDHL_USERNAME: 'apiUser', MYDHL_PASSWORD: 'p4ssw0rd-secret' }), echo);
    const tracked = JSON.stringify(await c.callTool({ name: 'track_shipment', arguments: { trackingNumber: '00340434292135100186' } }));
    expect(tracked).not.toContain(key);
    expect(tracked).toContain('<redacted>');
    const validated = JSON.stringify(await c.callTool({ name: 'validate_mydhl_shipment', arguments: { body: '{}' } }));
    expect(validated).not.toContain(basic);
    expect(validated).not.toContain('p4ssw0rd-secret');

    await c.close();
    const failing = await connect(loadConfig({ DHL_API_KEY: key }), () => Promise.reject(new TypeError(`bad header ${key}`)));
    const failed = await failing.callTool({ name: 'track_shipment', arguments: { trackingNumber: '00340434292135100186' } });
    expect(text(failed)).toBe('DHL did not answer: bad header <redacted>');
  });

  it('reports truncation only past 1 MB, without a broken character at the cut', async () => {
    const exact = 'a'.repeat(1024 * 1024);
    const c = await connect(loadConfig({}), dhl(200, exact));
    const res = await c.callTool({ name: 'track_shipment', arguments: { trackingNumber: '00340434292135100186' } });
    expect((res.structuredContent as { response: { truncated: boolean } }).response.truncated).toBe(false);

    await c.close();
    const over = `${'a'.repeat(1024 * 1024 - 1)}é and more`;
    const c2 = await connect(loadConfig({}), dhl(200, over));
    const cut = await c2.callTool({ name: 'track_shipment', arguments: { trackingNumber: '00340434292135100186' } });
    const { body, truncated } = (cut.structuredContent as { response: { body: string; truncated: boolean } }).response;
    expect(truncated).toBe(true);
    expect(body.endsWith('a')).toBe(true);
    expect(body).not.toContain('\uFFFD');
  });
});
