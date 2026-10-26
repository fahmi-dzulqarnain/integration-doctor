/** A request as the form holds it: headers as ordered name/value pairs. */
export interface DraftRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

export type ParseResult = { ok: true; request: DraftRequest; ignored: string[] } | { ok: false; error: string };

/**
 * Splits a shell command line the way bash would for curl's purposes, including the `$'…'`
 * quoting in Chrome's "Copy as cURL (bash)" and the `^` escapes in its "(cmd)" variant.
 */
export function tokenize(command: string): string[] | { error: string } {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | "$'" | null = null;
  const text = fromCmd(command).replace(/[\\`]\r?\n/g, ' ');

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (quote === "$'") {
      if (ch === "'") quote = null;
      else if (ch === '\\' && i + 1 < text.length) {
        const [decoded, used] = ansiEscape(text, i + 1);
        current += decoded;
        i += used;
      } else current += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < text.length && '"\\$`'.includes(text.charAt(i + 1))) current += text.charAt(++i);
      else current += ch;
    } else if (ch === '$' && text.charAt(i + 1) === "'") {
      quote = "$'";
      inToken = true;
      i++;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
    } else if (ch === '\\' && i + 1 < text.length) {
      current += text.charAt(++i);
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) tokens.push(current);
      current = '';
      inToken = false;
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (quote) return { error: `Unclosed ${quote} quote.` };
  if (inToken) tokens.push(current);
  return tokens;
}

/**
 * Chrome's "Copy as cURL (cmd)" quotes with `^"` and escapes cmd's special characters with `^`.
 * Removing the escapes leaves a command bash quoting rules can read.
 */
function fromCmd(command: string): string {
  if (!command.includes('^"')) return command;
  return command.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1');
}

/** Decodes one bash `$'…'` escape starting after the backslash; returns the text and its length. */
function ansiEscape(text: string, at: number): [string, number] {
  const ch = text.charAt(at);
  const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v' };
  if (ch in simple) return [simple[ch] ?? '', 1];
  const hex = /^(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8})/.exec(text.slice(at, at + 9));
  if (hex) {
    const code = Number.parseInt(hex[0].slice(1), 16);
    return [code <= 0x10ffff ? String.fromCodePoint(code) : '', hex[0].length];
  }
  return [`\\${ch}`, 1];
}

const DATA_FLAGS = new Set(['--data', '--data-raw', '--data-binary', '--data-ascii']);

/** Long options that take a value, so the value is never mistaken for the URL. */
const LONG_WITH_VALUE = new Set([
  '--request', '--header', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json',
  '--user', '--url', '--oauth2-bearer', '--form', '--form-string', '--cookie', '--cookie-jar', '--output',
  '--max-time', '--connect-timeout', '--user-agent', '--referer', '--write-out', '--cacert', '--capath', '--cert',
  '--key', '--proxy', '--proxy-user', '--range', '--upload-file', '--resolve', '--connect-to', '--interface',
  '--dump-header', '--config', '--retry', '--retry-delay', '--limit-rate', '--aws-sigv4', '--variable', '--url-query',
  '--max-redirs', '--ciphers', '--cert-type', '--key-type', '--pass', '--trace', '--trace-ascii', '--stderr',
]);

/** Short options with a value, and the long option each one means. */
const SHORT: Record<string, string> = {
  X: '--request', H: '--header', d: '--data', u: '--user', o: '--output', m: '--max-time', A: '--user-agent',
  e: '--referer', w: '--write-out', b: '--cookie', c: '--cookie-jar', F: '--form', T: '--upload-file', x: '--proxy',
  U: '--proxy-user', r: '--range', E: '--cert', K: '--config', D: '--dump-header', G: '--get',
};

/** One option and its value, with `-sSX POST` and `--header=…` forms unbundled. */
function options(tokens: string[]): { flag?: string; value?: string; raw: string }[] {
  const out: { flag?: string; value?: string; raw: string }[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const raw = tokens[i] ?? '';
    if (raw.startsWith('--') && raw.length > 2) {
      const eq = raw.indexOf('=');
      const flag = eq > 0 ? raw.slice(0, eq) : raw;
      const value = eq > 0 ? raw.slice(eq + 1) : LONG_WITH_VALUE.has(flag) ? tokens[++i] : undefined;
      out.push({ flag, value, raw });
    } else if (raw.startsWith('-') && raw.length > 1) {
      for (let j = 1; j < raw.length; j++) {
        const letter = raw.charAt(j);
        const long = SHORT[letter];
        if (long === '--get') out.push({ flag: long, raw });
        else if (long) {
          const rest = raw.slice(j + 1);
          out.push({ flag: long, value: rest || tokens[++i], raw });
          break;
        } else out.push({ flag: `-${letter}`, raw });
      }
    } else out.push({ raw });
  }
  return out;
}

/** Reads the method, URL, headers and body out of a pasted curl command. */
export function parseCurl(command: string): ParseResult {
  const tokens = tokenize(command.trim());
  if (!Array.isArray(tokens)) return { ok: false, error: tokens.error };
  if (tokens[0] !== 'curl' && tokens[0] !== 'curl.exe') return { ok: false, error: 'Paste a command that starts with curl.' };

  let method: string | undefined;
  let url: string | undefined;
  let get = false;
  const headers: [string, string][] = [];
  const data: string[] = [];
  const ignored: string[] = [];

  for (const { flag, value = '', raw } of options(tokens)) {
    if (flag === undefined) url ??= raw;
    else if (flag === '--request') method = value.toUpperCase();
    else if (flag === '--header') {
      const colon = value.indexOf(':');
      if (colon > 0) headers.push([value.slice(0, colon).trim(), value.slice(colon + 1).trim()]);
    } else if (DATA_FLAGS.has(flag)) data.push(value);
    else if (flag === '--data-urlencode') data.push(urlencodeData(value));
    else if (flag === '--json') {
      data.push(value);
      addIfMissing(headers, 'Content-Type', 'application/json');
      addIfMissing(headers, 'Accept', 'application/json');
    } else if (flag === '--user') {
      const encoded = base64Utf8(value);
      if (encoded === undefined) return { ok: false, error: 'Could not read the -u credentials.' };
      headers.push(['Authorization', `Basic ${encoded}`]);
    } else if (flag === '--oauth2-bearer') headers.push(['Authorization', `Bearer ${value}`]);
    else if (flag === '--url') url = value;
    else if (flag === '--get') get = true;
    else if (!ignored.includes(flag)) ignored.push(flag);
  }

  if (!url) return { ok: false, error: 'No URL found in the command.' };
  if (get && data.length > 0) {
    // -G sends the data as the query string of a GET, not as a body.
    url += (url.includes('?') ? '&' : '?') + data.join('&');
    return { ok: true, request: { method: method ?? 'GET', url, headers, body: '' }, ignored };
  }
  if (data.length > 0 && !headers.some(([name]) => name.toLowerCase() === 'content-type')) {
    // What curl itself sends with -d.
    headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  return {
    ok: true,
    request: { method: method ?? (data.length > 0 ? 'POST' : 'GET'), url, headers, body: data.join('&') },
    ignored,
  };
}

/** curl's --data-urlencode: `name=content` encodes the content only, plain `content` all of it. */
function urlencodeData(value: string): string {
  const eq = value.indexOf('=');
  if (eq > 0) return `${value.slice(0, eq)}=${encodeURIComponent(value.slice(eq + 1))}`;
  return encodeURIComponent(eq === 0 ? value.slice(1) : value);
}

function base64Utf8(text: string): string | undefined {
  try {
    return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  } catch {
    return undefined;
  }
}

function addIfMissing(headers: [string, string][], name: string, value: string): void {
  if (!headers.some(([n]) => n.toLowerCase() === name.toLowerCase())) headers.push([name, value]);
}

/** A copy-and-paste curl command for the request, quoted for POSIX shells. */
export function toCurl(request: DraftRequest): string {
  const parts = ['curl'];
  if (request.method !== 'GET' || request.body) parts.push('-X', request.method);
  parts.push(shellQuote(request.url));
  for (const [name, value] of request.headers) if (name) parts.push('-H', shellQuote(`${name}: ${value}`));
  if (request.body) parts.push('--data-raw', shellQuote(request.body));
  return parts.join(' ');
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Reads "Name: value" lines; blank lines and lines without a colon are skipped. */
export function parseHeaderLines(text: string): [string, string][] {
  return text.split(/\r?\n/).flatMap((line): [string, string][] => {
    const colon = line.indexOf(':');
    return colon > 0 ? [[line.slice(0, colon).trim(), line.slice(colon + 1).trim()]] : [];
  });
}

export function headerLines(headers: [string, string][]): string {
  return headers.map(([name, value]) => `${name}: ${value}`).join('\n');
}
