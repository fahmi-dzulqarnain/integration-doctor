import type { CatalogueEntry, Detection, Finding, Severity, Source } from '@integration-doctor/rules';

const API_NAMES: Record<Detection['api'], string> = {
  tracking: 'Shipment Tracking – Unified',
  'location-finder': 'Location Finder – Unified',
  mydhl: 'MyDHL API',
  'parcel-de-shipping': 'Parcel DE Shipping',
  'legacy-express': 'Retired DHL Express API',
  unknown: 'Not a DHL API this tool knows',
};

const SEVERITY_LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Note' };

export function DetectionSummary({ detection }: { detection: Detection }) {
  return (
    <dl className="detection">
      <div><dt>API</dt><dd>{API_NAMES[detection.api]}</dd></div>
      {detection.environment !== 'unknown' && <div><dt>Environment</dt><dd>{detection.environment}</dd></div>}
      {detection.operation && <div><dt>Operation</dt><dd><code>{detection.operation}</code></dd></div>}
    </dl>
  );
}

export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <p className="all-clear">No problems found. That covers what can be checked without calling DHL.</p>;
  }
  const counts = (['error', 'warning', 'info'] as const)
    .map((severity) => [severity, findings.filter((f) => f.severity === severity).length] as const)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${count} ${SEVERITY_LABEL[severity].toLowerCase()}${count > 1 ? 's' : ''}`);
  return (
    <>
      <p className="summary">{counts.join(', ')}</p>
      <ol className="findings">
        {findings.map((finding, index) => (
          <li key={`${finding.ruleId}-${String(index)}`} className={`finding finding--${finding.severity}`}>
            <h3>
              <span className={`badge badge--${finding.severity}`}>{SEVERITY_LABEL[finding.severity]}</span>
              {finding.title}
            </h3>
            <p>{finding.detail}</p>
            {finding.path && <p className="path">At <code>{finding.path}</code></p>}
            <p className="fix"><strong>Fix:</strong> {finding.fix}</p>
            <Sources sources={finding.sources} />
          </li>
        ))}
      </ol>
    </>
  );
}

export function CatalogueMatches({ matches }: { matches: CatalogueEntry[] }) {
  return (
    <ol className="findings">
      {matches.map((entry) => (
        <li key={entry.id} className="finding finding--match">
          <h3>{entry.code && <span className="badge badge--code">{entry.code}</span>}{entry.title}</h3>
          <p>{entry.meaning}</p>
          <h4>Likely causes</h4>
          <ul>{entry.causes.map((cause) => <li key={cause}>{cause}</li>)}</ul>
          <h4>Fixes</h4>
          <ul>{entry.fixes.map((fix) => <li key={fix}>{fix}</li>)}</ul>
          <Sources sources={entry.sources} />
        </li>
      ))}
    </ol>
  );
}

function Sources({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="sources">
      Sources:{' '}
      {sources.map((source, index) => (
        <span key={source.url}>
          {index > 0 && ' · '}
          <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
          {!source.official && <span className="community"> (community)</span>}
        </span>
      ))}
    </p>
  );
}
