import { BadGatewayException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { diagnose, explain, type Diagnosis, type Explanation } from '@integration-doctor/rules';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { ProbeDto } from '../dto.js';
import { Pacer } from '@integration-doctor/rules';

/** Response headers worth showing: the content type and DHL's quota counters. */
const SHOWN_HEADERS = /^(content-type|ratelimit-.*|x-ratelimit-.*|retry-after)$/i;
const MAX_SHOWN_BODY = 64 * 1024;
/** Reading stops here, so an endless or huge body cannot exhaust memory. */
const MAX_READ = 1024 * 1024;

export interface ProbeResult {
  request: { method: 'GET'; url: string; headers: Record<string, string> };
  response: { status: number; headers: Record<string, string>; body: string; truncated: boolean };
  diagnosis: Diagnosis;
  explanation?: Explanation;
  remainingToday: number;
}

/**
 * Calls DHL Shipment Tracking with DHL's public demo-key only. The hosted API never accepts a
 * user's own key: DHL's terms forbid sharing keys with third parties, so live checks with a real
 * key belong in a tool that runs on the user's machine.
 */
@Injectable()
export class ProbeService {
  private readonly pacer: Pacer;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.pacer = new Pacer(config.probeIntervalMs, config.probeDailyLimit);
  }

  async trackShipment(input: ProbeDto): Promise<ProbeResult> {
    const slot = this.pacer.acquire();
    if (!slot.ok) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: slot.reason === 'daily'
            ? 'The shared demo-key quota for today is used up. It resets at 00:00 GMT.'
            : 'DHL allows one demo-key call every few seconds. Try again shortly.',
          retryAfterSeconds: slot.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const url = new URL(this.config.trackingUrl);
    url.searchParams.set('trackingNumber', input.trackingNumber);
    if (input.service) url.searchParams.set('service', input.service);
    const headers = { 'DHL-API-Key': 'demo-key', Accept: 'application/json' };

    let upstream: Response;
    let read: { text: string; truncated: boolean };
    try {
      upstream = await fetch(url, { headers, signal: AbortSignal.timeout(this.config.probeTimeoutMs) });
      // Inside the try: DHL can send headers and then stall or reset while the body streams.
      read = await readCapped(upstream, MAX_READ);
    } catch (error) {
      throw new BadGatewayException(`DHL did not answer: ${error instanceof Error ? error.message : String(error)}`);
    }

    const shownHeaders = Object.fromEntries([...upstream.headers].filter(([name]) => SHOWN_HEADERS.test(name)));
    const request = { method: 'GET' as const, url: url.toString(), headers };
    const text = read.text;
    const response = {
      status: upstream.status,
      headers: shownHeaders,
      body: text.length > MAX_SHOWN_BODY ? text.slice(0, MAX_SHOWN_BODY) : text,
      truncated: read.truncated || text.length > MAX_SHOWN_BODY,
    };
    return {
      request,
      response,
      diagnosis: diagnose(request),
      ...(upstream.ok ? {} : { explanation: explain({ status: upstream.status, body: text, headers: shownHeaders, request }) }),
      remainingToday: this.pacer.remainingToday(),
    };
  }
}

/** Reads at most `limit` bytes of the body as UTF-8, then cancels the rest. */
async function readCapped(response: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false };
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
    chunks.push(value);
    size += value.byteLength;
    if (size >= limit) {
      await reader.cancel();
      return { text: Buffer.concat(chunks).subarray(0, limit).toString('utf8'), truncated: true };
    }
  }
}
