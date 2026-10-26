import { describe, expect, it } from 'vitest';
import { headerLines, parseCurl, parseHeaderLines, toCurl, tokenize } from '../src/curl.js';

describe('tokenize', () => {
  it('handles quotes, escapes and line continuations', () => {
    expect(tokenize(`curl -H "A: \\"b\\"" \\\n  'c d' e\\ f`)).toEqual(['curl', '-H', 'A: "b"', 'c d', 'e f']);
  });

  it('reports an unclosed quote', () => {
    expect(tokenize(`curl 'abc`)).toEqual({ error: "Unclosed ' quote." });
  });
});

describe('parseCurl', () => {
  it('reads a tracking request', () => {
    const result = parseCurl(`curl -X GET 'https://api-eu.dhl.com/track/shipments?trackingNumber=1' -H 'DHL-API-Key: demo-key'`);
    expect(result).toEqual({
      ok: true,
      ignored: [],
      request: { method: 'GET', url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=1', headers: [['DHL-API-Key', 'demo-key']], body: '' },
    });
  });

  it('reads -u, --data-raw and inline flag values, and defaults to POST', () => {
    const result = parseCurl(`curl -s --url=https://express.api.dhl.com/mydhlapi/test/shipments -u user:pass --header='Content-Type: application/json' --data-raw '{"a":1}' -o out.json`);
    expect(result.ok && result.request).toEqual({
      method: 'POST',
      url: 'https://express.api.dhl.com/mydhlapi/test/shipments',
      headers: [['Authorization', `Basic ${btoa('user:pass')}`], ['Content-Type', 'application/json']],
      body: '{"a":1}',
    });
    expect(result.ok && result.ignored).toEqual(['-s', '--output']);
  });

  it('adds the headers curl adds for --json and -d', () => {
    const json = parseCurl(`curl --json '{}' https://example.com`);
    expect(json.ok && json.request.headers).toEqual([['Content-Type', 'application/json'], ['Accept', 'application/json']]);
    const form = parseCurl(`curl -d a=1 https://example.com`);
    expect(form.ok && form.request.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']]);
  });

  it('reads Chrome "Copy as cURL (bash)" quoting', () => {
    const result = parseCurl(String.raw`curl 'https://express.api.dhl.com/mydhlapi/test/shipments' \
  -H 'content-type: application/json' \
  --data-raw $'{"description":"it\'s\nfragile","city":"Kota Bharu é"}'`);
    expect(result.ok && result.request.body).toBe(`{"description":"it's\nfragile","city":"Kota Bharu é"}`);
  });

  it('reads Chrome "Copy as cURL (cmd)" escapes', () => {
    const result = parseCurl(`curl ^"https://api-eu.dhl.com/track/shipments?trackingNumber=1^&service=express^" ^\n  -H ^"DHL-API-Key: k^"`);
    expect(result.ok && result.request).toEqual({
      method: 'GET',
      url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=1&service=express',
      headers: [['DHL-API-Key', 'k']],
      body: '',
    });
  });

  it('never takes an option value for the URL, and unbundles short flags', () => {
    const cookie = parseCurl(`curl -b 'a=b' -sSX POST --cacert ca.pem https://example.com/x -d '{}'`);
    expect(cookie.ok && [cookie.request.method, cookie.request.url]).toEqual(['POST', 'https://example.com/x']);
    expect(cookie.ok && cookie.ignored).toEqual(['--cookie', '-s', '-S', '--cacert']);
  });

  it('turns -G data into a query string and encodes --data-urlencode', () => {
    const result = parseCurl(`curl -G --data-urlencode 'trackingNumber=0034 0434' -d service=express https://api-eu.dhl.com/track/shipments`);
    expect(result.ok && result.request).toEqual({
      method: 'GET',
      url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=0034%200434&service=express',
      headers: [],
      body: '',
    });
  });

  it('encodes non-Latin-1 -u credentials as UTF-8, and reads --oauth2-bearer', () => {
    const result = parseCurl(`curl -u 'u:pässwörd€' --oauth2-bearer tok https://example.com`);
    const bytes = String.fromCharCode(...new TextEncoder().encode('u:pässwörd€'));
    expect(result.ok && result.request.headers).toEqual([['Authorization', `Basic ${btoa(bytes)}`], ['Authorization', 'Bearer tok']]);
  });

  it('rejects input that is not a curl command or has no URL', () => {
    expect(parseCurl('wget https://example.com')).toEqual({ ok: false, error: 'Paste a command that starts with curl.' });
    expect(parseCurl('curl -H "A: b"')).toEqual({ ok: false, error: 'No URL found in the command.' });
  });
});

describe('toCurl', () => {
  it('round-trips through parseCurl, including single quotes in the body', () => {
    const request = { method: 'POST', url: 'https://example.com/a?b=c&d=e', headers: [['X-Note', "it's"], ['Content-Type', 'application/json']] as [string, string][], body: `{"name":"O'Neil"}` };
    const curl = toCurl(request);
    const parsed = parseCurl(curl);
    expect(parsed.ok && parsed.request).toEqual(request);
  });

  it('leaves out -X for a plain GET', () => {
    expect(toCurl({ method: 'GET', url: 'https://example.com/x', headers: [], body: '' })).toBe('curl https://example.com/x');
  });
});

describe('header lines', () => {
  it('parses and prints Name: value lines', () => {
    const headers = parseHeaderLines('A: 1\n\nnot a header\nB:  two: parts ');
    expect(headers).toEqual([['A', '1'], ['B', 'two: parts']]);
    expect(headerLines(headers)).toBe('A: 1\nB: two: parts');
  });
});
