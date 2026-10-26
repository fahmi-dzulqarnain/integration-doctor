import { Pacer } from '@integration-doctor/rules';
import type { Config } from './config.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A request as it was sent, with credentials replaced by a description of where they came from. */
export interface SentRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface DhlAnswer {
  request: SentRequest;
  /** The same request with the real credentials, for the checks only; never returned to the client. */
  checked: SentRequest;
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

export class PacingError extends Error {
  constructor(readonly retryAfterSeconds: number, reason: 'interval' | 'daily') {
    super(reason === 'daily'
      ? `This key's daily quota is used up in this session; it resets at 00:00 GMT (in about ${Math.ceil(retryAfterSeconds / 60)} min).`
      : `DHL allows one call every few seconds on this key. Wait ${retryAfterSeconds} s and try again.`);
  }
}

export class UpstreamError extends Error {}

const SHOWN_HEADERS = /^(content-type|ratelimit-.*|x-ratelimit-.*|retry-after|x-correlation-id|message-reference)$/i;
const MAX_READ = 1024 * 1024;

/** The two DHL APIs the live tools may call. Both calls are read-only on DHL's side. */
export class DhlClient {
  private readonly trackingPacer = new Pacer(5000, 250);
  // DHL's portal lists 500 calls a day for the MyDHL test environment.
  private readonly mydhlPacer = new Pacer(1000, 500);

  /** Every credential the client sends, longest first, so none can come back out. */
  private readonly secrets: string[];

  constructor(private readonly config: Config, private readonly fetchImpl: FetchLike = fetch) {
    const { dhlApiKey, mydhl } = config;
    this.secrets = [
      dhlApiKey,
      mydhl?.password,
      mydhl ? Buffer.from(`${mydhl.username}:${mydhl.password}`).toString('base64') : undefined,
      mydhl ? encodeURIComponent(mydhl.password) : undefined,
    ]
      // Very short values would blank out ordinary text; real DHL keys and passwords are longer.
      .filter((s): s is string => s !== undefined && s.length >= 6)
      .sort((a, b) => b.length - a.length);
  }

  /** Replaces any credential in text from DHL or from fetch, e.g. a 401 body echoing headers. */
  scrub(text: string): string {
    return this.secrets.reduce((out, secret) => out.split(secret).join('<redacted>'), text);
  }

  get usesOwnTrackingKey(): boolean {
    return this.config.dhlApiKey !== undefined;
  }

  get canValidateShipments(): boolean {
    return this.config.mydhl !== undefined;
  }

  async track(trackingNumber: string, service?: string): Promise<DhlAnswer> {
    const url = new URL(this.config.trackingUrl);
    url.searchParams.set('trackingNumber', trackingNumber);
    if (service) url.searchParams.set('service', service);
    take(this.trackingPacer);
    const key = this.config.dhlApiKey ?? 'demo-key';
    const shown = this.config.dhlApiKey ? `<your key from DHL_API_KEY, ending ${lastFour(key)}>` : 'demo-key';
    return this.send(
      { method: 'GET', url: url.toString(), headers: { 'DHL-API-Key': key, Accept: 'application/json' } },
      { 'DHL-API-Key': shown },
    );
  }

  /** POST /shipments with validateDataOnly=true: DHL checks the shipment and creates nothing. */
  async validateShipment(body: string): Promise<DhlAnswer> {
    const mydhl = this.config.mydhl;
    if (!mydhl) throw new UpstreamError('MyDHL credentials are not configured.');
    const target = new URL(mydhl.baseUrl);
    target.pathname = `${target.pathname.replace(/\/+$/, '')}/shipments`;
    target.search = '';
    target.hash = '';
    target.searchParams.set('validateDataOnly', 'true');
    // Belt and braces: without exactly this flag, DHL would create a real shipment.
    if (target.searchParams.getAll('validateDataOnly').join() !== 'true' || target.username || target.password) {
      throw new UpstreamError('Refusing to call MyDHL without validateDataOnly=true.');
    }
    const url = target.toString();
    take(this.mydhlPacer);
    return this.send(
      {
        method: 'POST',
        url,
        headers: {
          Authorization: `Basic ${Buffer.from(`${mydhl.username}:${mydhl.password}`).toString('base64')}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-version': '3.4.0',
        },
        body,
      },
      { Authorization: '<Basic credentials from MYDHL_USERNAME and MYDHL_PASSWORD>' },
    );
  }

  private async send(request: SentRequest, redacted: Record<string, string>): Promise<DhlAnswer> {
    let response: Response;
    let read: { text: string; truncated: boolean };
    try {
      response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
        redirect: 'error',
      });
      read = await readCapped(response, MAX_READ);
    } catch (error) {
      throw new UpstreamError(this.scrub(`DHL did not answer: ${error instanceof Error ? error.message : String(error)}`));
    }
    return {
      request: { ...request, headers: { ...request.headers, ...redacted } },
      checked: request,
      status: response.status,
      headers: Object.fromEntries([...response.headers]
        .filter(([name]) => SHOWN_HEADERS.test(name))
        .map(([name, value]) => [name, this.scrub(value)])),
      body: this.scrub(read.text),
      truncated: read.truncated,
    };
  }
}

function take(pacer: Pacer): void {
  const slot = pacer.acquire();
  if (!slot.ok) throw new PacingError(slot.retryAfterSeconds, slot.reason);
}

function lastFour(key: string): string {
  return key.length > 8 ? key.slice(-4) : '…';
}

/** Reads at most `limit` bytes; a character split by the cut is dropped rather than garbled. */
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
    if (size > limit) {
      await reader.cancel();
      const text = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, limit), { stream: true });
      return { text, truncated: true };
    }
  }
}
