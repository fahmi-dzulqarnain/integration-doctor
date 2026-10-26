#!/usr/bin/env node
import { main } from './cli.js';

main(process.argv.slice(2), {
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}).then(
  (code) => {
    if (code !== 0) process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`integration-doctor: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
