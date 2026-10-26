import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/** A misbehaving DHL: a 2 MB body for "HUGE", headers then silence for "STALL". */
let stub: Server;
let app: INestApplication;
let server: Parameters<typeof request>[0];

beforeAll(async () => {
  stub = createServer((req, res) => {
    const number = new URL(req.url ?? '/', 'http://stub').searchParams.get('trackingNumber');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (number === 'STALL') {
      res.write('{"shipments":[');
      return;
    }
    res.end(number === 'HUGE' ? `"${'x'.repeat(2 * 1024 * 1024)}"` : '{"shipments":[]}');
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const { port } = stub.address() as AddressInfo;

  app = await createApp({
    ...loadConfig({}),
    trackingUrl: `http://127.0.0.1:${port}/track/shipments`,
    probeIntervalMs: 0,
    probeTimeoutMs: 300,
    probePerClientPerHour: 3,
    rateLimitPerMinute: 1000,
    trustProxyHops: 0,
  });
  await app.init();
  server = app.getHttpServer() as Parameters<typeof request>[0];
});

afterAll(async () => {
  await app.close();
  stub.closeAllConnections();
  await new Promise((resolve) => stub.close(resolve));
});

describe('probe safeguards', () => {
  it('caps how much of DHL\'s body is read', async () => {
    const res = await request(server).post('/api/probe/tracking').send({ trackingNumber: 'HUGE' });
    expect(res.status).toBe(200);
    expect(res.body.response.truncated).toBe(true);
    expect(res.body.response.body.length).toBe(64 * 1024);
  });

  it('answers 502 when DHL stalls in the middle of the body', async () => {
    const res = await request(server).post('/api/probe/tracking').send({ trackingNumber: 'STALL' });
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/^DHL did not answer/);
  });

  it('limits each client per hour, and a forged X-Forwarded-For does not reset it', async () => {
    const ok = await request(server).post('/api/probe/tracking').set('X-Forwarded-For', '203.0.113.1').send({ trackingNumber: '00340434292135100186' });
    expect(ok.status).toBe(200);
    const limited = await request(server).post('/api/probe/tracking').set('X-Forwarded-For', '203.0.113.2').send({ trackingNumber: '00340434292135100186' });
    expect(limited.status).toBe(429);
    // Other endpoints keep working for that client.
    expect((await request(server).get('/api/catalogue')).status).toBe(200);
  });
});
