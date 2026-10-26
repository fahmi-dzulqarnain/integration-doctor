import type { CatalogueEntry, Detection, Explanation, Finding, Source } from '@integration-doctor/rules';

/** Plain-text renderings for the assistant to read; structured content carries the same data. */

const API_NAMES: Record<Detection['api'], string> = {
  tracking: 'Shipment Tracking – Unified',
  'location-finder': 'Location Finder – Unified',
  mydhl: 'MyDHL API',
  'parcel-de-shipping': 'Parcel DE Shipping',
  'legacy-express': 'a retired DHL Express API',
  unknown: 'no DHL API this tool knows',
};

export function describeDetection(detection: Detection): string {
  const parts = [`API: ${API_NAMES[detection.api]}`];
  if (detection.environment !== 'unknown') parts.push(`environment: ${detection.environment}`);
  if (detection.operation) parts.push(`operation: ${detection.operation}`);
  return parts.join('; ');
}

export function describeFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'No problems found by the offline checks.';
  return findings.map((f, i) => [
    `${i + 1}. [${f.severity}] ${f.title}`,
    `   ${f.detail}`,
    ...(f.path ? [`   Field: ${f.path}`] : []),
    `   Fix: ${f.fix}`,
    ...(f.sources.length ? [`   Sources: ${describeSources(f.sources)}`] : []),
  ].join('\n')).join('\n');
}

export function describeEntry(entry: CatalogueEntry): string {
  return [
    `${entry.code ? `${entry.code}: ` : ''}${entry.title} (id ${entry.id})`,
    `   ${entry.meaning}`,
    `   Likely causes: ${entry.causes.join(' | ')}`,
    `   Fixes: ${entry.fixes.join(' | ')}`,
    `   Sources: ${describeSources(entry.sources)}`,
  ].join('\n');
}

export function describeExplanation(explanation: Explanation): string {
  const lines = [describeDetection(explanation.detection)];
  if (explanation.message) lines.push(`DHL said: "${explanation.message}"`);
  if (explanation.codes.length) lines.push(`Error codes: ${explanation.codes.join(', ')}`);
  if (explanation.path) lines.push(`Field: ${explanation.path}`);
  lines.push(explanation.matches.length
    ? `Known errors that match:\n${explanation.matches.map(describeEntry).join('\n')}`
    : 'No known error in the catalogue matches. Check the field DHL names against the API reference.');
  if (explanation.requestFindings.length) lines.push(`Checks on the request:\n${describeFindings(explanation.requestFindings)}`);
  return lines.join('\n');
}

function describeSources(sources: Source[]): string {
  return sources.map((s) => `${s.label}${s.official ? '' : ' (community)'} <${s.url}>`).join('; ');
}

/** A catalogue entry as JSON: a RegExp would otherwise serialise as {}. */
export function entryJson({ pattern, ...entry }: CatalogueEntry): Record<string, unknown> {
  return pattern ? { ...entry, pattern: pattern.source, patternFlags: pattern.flags } : { ...entry };
}
