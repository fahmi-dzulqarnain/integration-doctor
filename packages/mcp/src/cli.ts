import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './config.js';
import { createServer, packageVersion, SERVER_NAME } from './server.js';

export interface Io {
  env: NodeJS.ProcessEnv;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

const HELP = `${SERVER_NAME} ${packageVersion()}: MCP server for Integration Doctor for DHL APIs (stdio).

Not affiliated with DHL. Add it to an MCP client, e.g. Claude Desktop or Claude Code:

  { "command": "node", "args": ["<repo>/packages/mcp/dist/src/index.js"],
    "env": { "DHL_API_KEY": "<optional>" } }

Environment (all optional):
  DHL_API_KEY        Your Shipment Tracking key. Without it, track_shipment uses DHL's demo-key.
  MYDHL_USERNAME     MyDHL API credentials; with both set, validate_mydhl_shipment is offered.
  MYDHL_PASSWORD
  MYDHL_BASE_URL     Default https://express.api.dhl.com/mydhlapi/test
  DHL_TRACKING_URL   Default https://api-eu.dhl.com/track/shipments
  DHL_TIMEOUT_MS     Default 15000

Keys stay on this machine: no tool accepts one as input, and outputs show where a key came from
and its last four characters, never the whole key.
`;

/** Runs the server on stdio; stdout carries the protocol, so messages go to stderr. */
export async function main(args: string[], io: Io): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout.write(HELP);
    return 0;
  }
  if (args.includes('--version')) {
    io.stdout.write(`${packageVersion()}\n`);
    return 0;
  }
  if (args.length > 0) {
    io.stderr.write(`${SERVER_NAME}: unknown argument ${args[0] ?? ''}. Try --help.\n`);
    return 2;
  }

  let config;
  try {
    config = loadConfig(io.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      io.stderr.write(`${SERVER_NAME}: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const server = createServer({ config });
  await server.connect(new StdioServerTransport(io.stdin, io.stdout));
  io.stderr.write(`${SERVER_NAME} ${packageVersion()} running on stdio (${config.dhlApiKey ? 'own tracking key' : 'demo-key'}${config.mydhl ? ', MyDHL validation on' : ''}).\n`);
  return 0;
}
