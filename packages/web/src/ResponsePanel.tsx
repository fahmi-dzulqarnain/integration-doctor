import { explain, type Explanation } from '@integration-doctor/rules';
import { useId, useState } from 'react';
import { RESPONSE_EXAMPLES } from './examples.js';
import { CatalogueMatches, DetectionSummary } from './Results.js';

export function ResponsePanel() {
  const id = useId();
  const [status, setStatus] = useState('400');
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [explained, setExplained] = useState<{ input: { status: string; url: string; body: string }; explanation: Explanation }>();
  const stale = explained !== undefined && JSON.stringify(explained.input) !== JSON.stringify({ status, url, body });

  function run(next: { status: string; url: string; body: string }) {
    const code = Number(next.status);
    setExplained({ input: next, explanation: explain({
      status: Number.isInteger(code) ? code : 0,
      body: next.body,
      ...(next.url.trim() ? { request: { method: 'GET', url: next.url.trim() } } : {}),
    }) });
  }

  return (
    <div className="panel-grid">
      <section aria-labelledby={`${id}-input`} className="card">
        <h2 id={`${id}-input`}>DHL's response</h2>
        <p className="hint">Explained in your browser against a catalogue of known DHL errors.</p>

        <div className="examples">
          <span id={`${id}-examples`}>Try an example:</span>
          <ul aria-labelledby={`${id}-examples`}>
            {RESPONSE_EXAMPLES.map((example) => (
              <li key={example.label}>
                <button type="button" className="link-button" onClick={() => {
                  const next = { status: String(example.status), url: example.url, body: example.body };
                  setStatus(next.status);
                  setUrl(next.url);
                  setBody(next.body);
                  run(next);
                }}>{example.label}</button>
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); run({ status, url, body }); }}>
          <div className="row">
            <div className="field field--method">
              <label htmlFor={`${id}-status`}>Status</label>
              <input id={`${id}-status`} type="number" min={100} max={599} required value={status} onChange={(e) => { setStatus(e.target.value); }} />
            </div>
            <div className="field field--grow">
              <label htmlFor={`${id}-url`}>Request URL <span className="hint">optional, narrows the API</span></label>
              <input id={`${id}-url`} type="text" inputMode="url" spellCheck={false} value={url} onChange={(e) => { setUrl(e.target.value); }} />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${id}-body`}>Response body</label>
            <textarea id={`${id}-body`} rows={10} spellCheck={false} value={body} onChange={(e) => { setBody(e.target.value); }} />
          </div>
          <button type="submit" className="primary">Explain error</button>
        </form>
      </section>

      <section aria-labelledby={`${id}-results`} className="card results">
        <h2 id={`${id}-results`}>Explanation</h2>
        <p role="status" className="visually-hidden">
          {explained ? (stale ? 'The explanation is for an earlier response.' : `Explained: ${explained.explanation.matches.length} known error${explained.explanation.matches.length === 1 ? '' : 's'} matched.`) : ''}
        </p>
        {explained && stale && <p className="stale">You've changed the response since this explanation. Choose Explain error to update it.</p>}
        {explained ? <ExplanationView explanation={explained.explanation} /> : (
          <p className="hint">Paste the status and body DHL returned, or pick an example, then choose Explain error.</p>
        )}
      </section>
    </div>
  );
}

export function ExplanationView({ explanation }: { explanation: Explanation }) {
  return (
    <>
      <DetectionSummary detection={explanation.detection} />
      {explanation.message && <p className="dhl-message">DHL said: <q>{explanation.message}</q></p>}
      {explanation.codes.length > 0 && <p>Error codes: {explanation.codes.map((code) => <code key={code} className="code-chip">{code}</code>)}</p>}
      {explanation.path && <p className="path">Field: <code>{explanation.path}</code></p>}
      {explanation.matches.length > 0
        ? <CatalogueMatches matches={explanation.matches} />
        : <p className="all-clear">This error isn't in the catalogue yet. Check the field DHL names, and the API reference for the endpoint.</p>}
    </>
  );
}
