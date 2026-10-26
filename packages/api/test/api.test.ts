import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/** Stands in for DHL Shipment Tracking: answers like the demo-key, or 401 for an unknown number. */
let stub: Server;
let lastStubRequest: IncomingMessage | undefined;
let app: INestApplication;
let server: Parameters<typeof request>[0];

beforeAll(async () => {
  stub = createServer((req, res) => {
    lastStubRequest = req;
    const url = new URL(req.url ?? '/', 'http://stub');
    if (url.searchParams.get('trackingNumber') === 'UNAUTHORISED') {
      res.writeHead(401, { 'content-type': 'application/problem+json' });
      res.end('{"status":401,"title":"Unauthorized","detail":"Unauthorized for given resource."}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'ratelimit-remaining': '249', 'set-cookie': 'tracking=1' });
    res.end(JSON.stringify({ shipments: [{ id: url.searchParams.get('trackingNumber'), service: 'express' }] }));
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const { port } = stub.address() as AddressInfo;

  app = await createApp({
    ...loadConfig({}),
    trackingUrl: `http://127.0.0.1:${port}/track/shipments`,
    probeIntervalMs: 0,
    probeDailyLimit: 2,
    rateLimitPerMinute: 1000,
    probePerClientPerHour: 1000,
  });
  await app.init();
  server = app.getHttpServer() as Parameters<typeof request>[0];
});

afterAll(async () => {
  await app.close();
  await new Promise((resolve) => stub.close(resolve));
});

beforeEach(() => {
  lastStubRequest = undefined;
});

describe('POST /api/diagnose', () => {
  it('returns the findings for a request', async () => {
    const res = await request(server).post('/api/diagnose').send({
      method: 'GET',
      url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186',
      headers: { Authorization: 'Bearer abc' },
    });
    expect(res.status).toBe(200);
    expect(res.body.detection).toMatchObject({ api: 'tracking', environment: 'production', operation: 'GET /shipments' });
    expect(res.body.findings.map((f: { ruleId: string }) => f.ruleId)).toContain('auth.missing-api-key');
  });

  it('rejects a malformed payload with the reasons', async () => {
    const res = await request(server).post('/api/diagnose').send({ method: 'GET', headers: { 'DHL-API-Key': 42 }, extra: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(expect.arrayContaining([
      'property extra should not exist',
      'url must be a string',
      'headers must map header names to string values (at most 100 headers)',
    ]));
  });

  it('rejects a body over the size limit', async () => {
    const res = await request(server).post('/api/diagnose').send({ method: 'POST', url: 'https://example.com', body: 'x'.repeat(700 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe('POST /api/explain', () => {
  it('matches a DHL error against the catalogue', async () => {
    const res = await request(server).post('/api/explain').send({
      status: 401,
      body: '{"status":401,"title":"Unauthorized","detail":"Unauthorized for given resource."}',
      request: { method: 'GET', url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=1' },
    });
    expect(res.status).toBe(200);
    expect(res.body.matches[0].id).toBe('unified.401-not-for-resource');
    expect(res.body.detection.api).toBe('tracking');
  });

  it('validates the nested request', async () => {
    const res = await request(server).post('/api/explain').send({ status: 401, request: { method: 'GET' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('request.url must be a string');
  });
});

describe('GET /api/catalogue and /api/health', () => {
  it('lists the catalogue', async () => {
    const res = await request(server).get('/api/catalogue');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(20);
    expect(res.body.find((e: { id: string }) => e.id === 'mydhl.998-date').pattern).toContain('not well formatted');
    expect(res.body.find((e: { id: string }) => e.id === 'mydhl.998-date').patternFlags).toBe('i');
  });

  it('reports health', async () => {
    expect((await request(server).get('/api/health')).body).toEqual({ status: 'ok' });
  });
});

describe('POST /api/probe/tracking', () => {
  it('calls DHL with the demo-key only and returns the checks', async () => {
    const res = await request(server).post('/api/probe/tracking').send({ trackingNumber: '00340434292135100186', service: 'express' });
    expect(res.status).toBe(200);
    expect(lastStubRequest?.headers['dhl-api-key']).toBe('demo-key');
    expect(lastStubRequest?.url).toBe('/track/shipments?trackingNumber=00340434292135100186&service=express');
    expect(res.body.response).toMatchObject({ status: 200, headers: { 'ratelimit-remaining': '249', 'content-type': 'application/json' } });
    expect(res.body.response.headers).not.toHaveProperty('set-cookie');
    // The stub is not a DHL host, so only the shape of the diagnosis is checked here.
    expect(res.body.diagnosis).toHaveProperty('findings');
    expect(res.body.explanation).toBeUndefined();
  });

  it('explains an error answer', async () => {
    const res = await request(server).post('/api/probe/tracking').send({ trackingNumber: 'UNAUTHORISED' });
    expect(res.status).toBe(200);
    expect(res.body.response.status).toBe(401);
    expect(res.body.explanation.matches[0].id).toBe('unified.401-not-for-resource');
  });

  it('refuses a key or other extra fields', async () => {
    const res = await request(server).post('/api/probe/tracking').send({ trackingNumber: '00340434292135100186', apiKey: 'mine' });
    expect(res.status).toBe(400);
    expect(lastStubRequest).toBeUndefined();
  });

  it('refuses tracking numbers that could alter the query', async () => {
    const res = await request(server).post('/api/probe/tracking').send({ trackingNumber: '123&service=x' });
    expect(res.status).toBe(400);
  });

  it('stops at the daily quota', async () => {
    const res = await request(server).post('/api/probe/tracking').send({ trackingNumber: '00340434292135100186' });
    expect(res.status).toBe(429);
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(lastStubRequest).toBeUndefined();
  });
});
