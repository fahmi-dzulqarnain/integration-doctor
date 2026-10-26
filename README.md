# Integration Doctor for DHL APIs

Checks a DHL API request before you send it, and explains DHL's error responses in plain
language, with a link to where each explanation comes from.

> Not affiliated with, endorsed by, or sponsored by DHL or Deutsche Post DHL Group. "DHL" is
> their trademark and is used here only to say which APIs this tool works with.

## Why

Integrating DHL's APIs fails in a handful of ways, again and again, with terse answers:

- a key from the wrong app, which Shipment Tracking answers with `401 Unauthorized for given resource`;
- MyDHL's own date format, where an ISO 8601 date gets `998: ShipTimeStamp is not well formatted`;
- a 46-character address line, answered with `Parameters not having correct format: cityName (maxLength=45)`;
- a weekend pickup date, answered with `996: The requested product(s) not available for the requested pickup date`.

Each of these is documented somewhere, in DHL's API specifications, its support articles, or an
integrator's help centre, but rarely next to the error. This tool puts them together.

## What it does (phase 1: the rules engine)

`packages/rules` is a TypeScript library with no runtime dependencies. It runs in Node and in
the browser.

- **`diagnose(request)`**: 47 kinds of check across Shipment Tracking – Unified, Location Finder,
  MyDHL API and Parcel DE Shipping:
  - the host, environment and endpoint, against every operation in DHL's OpenAPI specifications;
  - the authentication scheme each API expects;
  - query parameters and the JSON body;
  - MyDHL `POST /shipments` fields (required, types, lengths, enums, unknown keys), validated
    against a subset of the 3.4.0 schema and reported in DHL's own validator wording;
  - business rules the schema cannot express: the shipping date window, export declarations for
    dutiable shipments, US domestic routes, pickup times.
- **`explain(response)`**: reads DHL's error formats (RFC 7807 problem documents for the unified
  APIs, MyDHL's coded details and validator messages with JSON pointers) and matches them against
  a catalogue of 29 known errors, each with causes, fixes and sources.

```ts
import { diagnose, explain } from '@integration-doctor/rules';

diagnose({
  method: 'GET',
  url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186',
  headers: { Authorization: 'Bearer abc' },
}).findings[0].title;
// 'No DHL-API-Key header'

explain({ status: 400, body: '{"detail":"998: ShipTimeStamp is not well formatted. …"}' }).matches[0].fixes;
// ['Send local time with the offset after "GMT": 2026-10-27T10:00:00GMT+08:00.']
```

### Design choices

- **Rules first, no AI in the core.** Every finding comes from a fixed rule with a cited source.
  A language model may later explain findings, but never decides them.
- **Sources are labelled.** DHL's own documentation is marked official; integrators' help
  centres and public issues are marked as community evidence.
- **Nothing calls DHL.** The checks work without a DHL account, which matters because MyDHL API
  credentials are only issued to DHL Express customers.

## Development

```bash
npm install
npm test          # Vitest
npm run lint      # ESLint, strict type-checked
npm run typecheck
npm run build
```

## Roadmap

1. Rules engine and error catalogue (this package)
2. NestJS API and React web app, with Playwright tests
3. MCP server, so an AI assistant can run the same checks with your own key, locally
4. Deployment to Google Kubernetes Engine with Terraform and GitHub Actions
