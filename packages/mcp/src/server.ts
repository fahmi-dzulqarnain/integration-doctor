import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  CATALOGUE,
  TRACKING_SERVICES,
  diagnose,
  explain,
  type DhlApi,
  type Diagnosis,
  type Explanation,
} from '@integration-doctor/rules';
import { z } from 'zod';
import type { Config } from './config.js';
import { DhlClient, PacingError, UpstreamError, type DhlAnswer, type FetchLike } from './dhl.js';
import { describeDetection, describeEntry, describeExplanation, describeFindings, entryJson } from './format.js';

export const SERVER_NAME = 'integration-doctor';

export function packageVersion(): string {
  // src/ when run from source, dist/src/ when built.
  for (const path of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { name?: unknown; version?: unknown };
      if (pkg.name === '@integration-doctor/mcp' && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // Try the next location.
    }
  }
  return '0.0.0';
}

const INSTRUCTIONS =
  'Integration Doctor helps developers integrate DHL APIs (Shipment Tracking, Location Finder, MyDHL API, '
  + 'Parcel DE Shipping). Use diagnose_request before a request is sent and explain_error after DHL answers with '
  + 'an error; quote the fixes and their sources rather than guessing. Findings come from fixed rules, not from '
  + 'you: do not add problems the tools did not report without saying they are your own reading. Never ask the '
  + 'user to paste an API key or password into the chat: placeholders work for the offline checks, and live tools '
  + 'read credentials from the server\'s environment. Not affiliated with DHL.';

const OFFLINE = { readOnlyHint: true, openWorldHint: false } as const;
// Live tools call DHL but change nothing there: tracking reads, and validateDataOnly creates no shipment.
const LIVE = { readOnlyHint: true, openWorldHint: true, idempotentHint: true } as const;

const APIS = ['tracking', 'location-finder', 'mydhl', 'parcel-de-shipping', 'legacy-express'] as const satisfies readonly DhlApi[];

/**
 * A body as text, or as the JSON value itself: assistants often pass a JSON body as an object,
 * so it is turned back into text before the checks see it.
 */
const bodyField = z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .transform((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
  .refine((text) => text.length <= 512 * 1024, 'body must be at most 512 KB');

const requestShape = {
  method: z.string().min(1).max(16).describe('HTTP method, e.g. GET or POST'),
  url: z.string().min(1).max(8192).describe('Full URL including the query string'),
  headers: z.record(z.string().max(256), z.string().max(8192)).optional()
    .describe('Header names to values. Use a placeholder such as "<key>" instead of a real key or password.'),
  body: bodyField.optional().describe('The request body as sent, e.g. the JSON for MyDHL POST /shipments'),
};

export interface ServerOptions {
  config: Config;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: FetchLike;
}

export function createServer({ config, fetch }: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: packageVersion() }, { instructions: INSTRUCTIONS });
  const dhl = new DhlClient(config, fetch);

  server.registerTool('diagnose_request', {
    title: 'Check a DHL API request',
    description: 'Checks a DHL API request without sending it: host and environment, endpoint, authentication scheme, '
      + 'query parameters, and for MyDHL POST /shipments the JSON body against the 3.4.0 schema and DHL\'s business '
      + 'rules (date format and window, export declarations, address lengths). Runs offline.',
    inputSchema: requestShape,
    annotations: OFFLINE,
  }, (request) => {
    const diagnosis = diagnose(request);
    return result(`${describeDetection(diagnosis.detection)}\n${describeFindings(diagnosis.findings)}`, diagnosis);
  });

  server.registerTool('explain_error', {
    title: 'Explain a DHL error response',
    description: 'Explains an error DHL returned: reads its error codes, message and the field it names, and matches '
      + 'them against a catalogue of known DHL errors with causes, fixes and sources. Give the request URL when known; '
      + 'it narrows the API. Runs offline.',
    inputSchema: {
      status: z.number().int().min(100).max(599).describe('HTTP status DHL returned'),
      body: bodyField.optional().describe('The response body as DHL sent it'),
      request: z.object(requestShape).optional().describe('The request that produced the error, when known'),
    },
    annotations: OFFLINE,
  }, ({ status, body, request }) => {
    const explanation = explain({ status, ...(body === undefined ? {} : { body }), ...(request ? { request } : {}) });
    return result(describeExplanation(explanation), explanation);
  });

  server.registerTool('search_known_errors', {
    title: 'Search the DHL error catalogue',
    description: 'Looks up known DHL errors by code (e.g. 998, 7121), by words in their title or meaning, or by API.',
    inputSchema: {
      query: z.union([z.string().max(200), z.number().int()]).transform(String).optional().describe('A code (e.g. 998) or words to look for'),
      api: z.enum(APIS).optional().describe('Only errors from this API'),
    },
    annotations: OFFLINE,
  }, ({ query, api }) => {
    const needle = query?.trim().toLowerCase();
    const entries = CATALOGUE.filter((entry) => {
      if (api && entry.api !== 'any' && !(Array.isArray(entry.api) ? entry.api.includes(api) : entry.api === api)) return false;
      if (!needle) return true;
      return [entry.code, entry.title, entry.meaning, entry.id].some((text) => text?.toLowerCase().includes(needle));
    });
    const text = entries.length
      ? `${entries.length} known error${entries.length === 1 ? '' : 's'}:\n${entries.map(describeEntry).join('\n')}`
      : 'No known error matches. Try a code alone (e.g. 998) or fewer words.';
    return result(text, { count: entries.length, entries: entries.map(entryJson) });
  });

  server.registerResource('catalogue', 'integration-doctor://catalogue', {
    title: 'Known DHL errors',
    description: 'Every entry in the error catalogue, with causes, fixes and sources',
    mimeType: 'application/json',
  }, (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(CATALOGUE.map(entryJson), null, 2) }],
  }));

  server.registerTool('track_shipment', {
    title: 'Track a shipment with DHL (live)',
    description: `Calls DHL Shipment Tracking – Unified from this machine ${dhl.usesOwnTrackingKey
      ? 'with the key in DHL_API_KEY'
      : 'with DHL\'s public demo-key, which answers with one fixed, mocked shipment (set DHL_API_KEY for real data)'}. `
      + 'Returns DHL\'s answer, the checks on the request, and an explanation if DHL answered with an error. '
      + 'Paced to DHL\'s limits: one call per 5 seconds, 250 a day.',
    inputSchema: {
      trackingNumber: z.string().regex(/^[A-Za-z0-9-]{4,64}$/, '4 to 64 letters, digits or hyphens').describe('The tracking number'),
      service: z.enum(TRACKING_SERVICES).optional().describe('Narrow to one DHL service'),
    },
    annotations: LIVE,
  }, async ({ trackingNumber, service }) => live(() => dhl.track(trackingNumber, service)));

  if (dhl.canValidateShipments) {
    server.registerTool('validate_mydhl_shipment', {
      title: 'Validate a MyDHL shipment with DHL (live)',
      description: 'Sends a MyDHL API create-shipment body to DHL with validateDataOnly=true, using the credentials in '
        + 'MYDHL_USERNAME and MYDHL_PASSWORD. DHL validates it and creates no shipment and no label. Runs the offline '
        + 'checks too, so both opinions are side by side.',
      inputSchema: {
        body: bodyField.describe('The JSON body for POST /shipments'),
      },
      annotations: LIVE,
    }, async ({ body }) => live(() => dhl.validateShipment(body)));
  }

  return server;
}

interface LiveResult {
  request: DhlAnswer['request'];
  response: { status: number; headers: Record<string, string>; body: string; truncated: boolean };
  diagnosis: Diagnosis;
  explanation?: Explanation;
}

async function live(call: () => Promise<DhlAnswer>): Promise<CallToolResult> {
  let answer: DhlAnswer;
  try {
    answer = await call();
  } catch (error) {
    if (error instanceof PacingError || error instanceof UpstreamError) return failure(error.message);
    throw error;
  }
  // The checks see the real request, so a malformed key is caught; their text never quotes header values.
  const diagnosis = diagnose(answer.checked);
  const ok = answer.status >= 200 && answer.status < 300;
  const explanation = ok ? undefined : explain({ status: answer.status, body: answer.body, headers: answer.headers, request: answer.checked });
  const structured: LiveResult = {
    request: answer.request,
    response: { status: answer.status, headers: answer.headers, body: answer.body, truncated: answer.truncated },
    diagnosis,
    ...(explanation ? { explanation } : {}),
  };
  const text = [
    `${answer.request.method} ${answer.request.url}`,
    `DHL answered HTTP ${answer.status}${answer.truncated ? ' (body cut at 1 MB)' : ''}.`,
    explanation ? describeExplanation(explanation) : '',
    `Checks on the request:\n${describeFindings(diagnosis.findings)}`,
    `Response body:\n${answer.body.slice(0, 8000)}${answer.body.length > 8000 ? '\n… (shortened; the full body is in the structured result)' : ''}`,
  ].filter(Boolean).join('\n\n');
  return result(text, structured);
}

function result(text: string, structured: object): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured as Record<string, unknown> };
}

function failure(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
