import { diagnose, type Diagnosis } from '@integration-doctor/rules';
import { useId, useState } from 'react';
import { headerLines, parseCurl, parseHeaderLines, toCurl, type DraftRequest } from './curl.js';
import { REQUEST_EXAMPLES } from './examples.js';
import { CopyButton } from './CopyButton.js';
import { DetectionSummary, FindingsList } from './Results.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function RequestPanel() {
  const id = useId();
  const [curl, setCurl] = useState('');
  const [curlMessage, setCurlMessage] = useState<string>();
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('');
  const [body, setBody] = useState('');
  const [checked, setChecked] = useState<{ request: DraftRequest; diagnosis: Diagnosis }>();

  const draft = (): DraftRequest => ({ method, url: url.trim(), headers: parseHeaderLines(headers), body });
  const stale = checked !== undefined && JSON.stringify(draft()) !== JSON.stringify(checked.request);

  function load(request: DraftRequest) {
    setMethod(request.method);
    setUrl(request.url);
    setHeaders(headerLines(request.headers));
    setBody(request.body);
    check(request);
  }

  function check(request: DraftRequest) {
    // Runs in the browser: the request, and any key in it, never leaves this page.
    setChecked({ request, diagnosis: diagnose({ ...request, body: request.body || undefined }) });
  }

  function importCurl() {
    const result = parseCurl(curl);
    if (!result.ok) {
      setCurlMessage(result.error);
      return;
    }
    setCurlMessage(result.ignored.length > 0 ? `Read the command. Ignored options: ${result.ignored.join(' ')}` : 'Read the command.');
    load(result.request);
  }

  return (
    <div className="panel-grid">
      <section aria-labelledby={`${id}-input`} className="card">
        <h2 id={`${id}-input`}>Your request</h2>
        <p className="hint">Checked in your browser. Nothing you enter here is sent anywhere.</p>

        <div className="examples">
          <span id={`${id}-examples`}>Try an example:</span>
          <ul aria-labelledby={`${id}-examples`}>
            {REQUEST_EXAMPLES.map((example) => (
              <li key={example.label}>
                <button type="button" className="link-button" onClick={() => { setCurlMessage(undefined); load(example.request); }}>
                  {example.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <details className="curl-import">
          <summary>Paste a curl command instead</summary>
          <label htmlFor={`${id}-curl`}>curl command</label>
          <textarea id={`${id}-curl`} rows={4} spellCheck={false} value={curl} onChange={(e) => { setCurl(e.target.value); }}
            placeholder="curl -H 'DHL-API-Key: …' 'https://api-eu.dhl.com/track/shipments?trackingNumber=…'" />
          <button type="button" onClick={importCurl}>Read command</button>
          {curlMessage && <p role="status" className="hint">{curlMessage}</p>}
        </details>

        <form onSubmit={(e) => { e.preventDefault(); check(draft()); }}>
          <div className="row">
            <div className="field field--method">
              <label htmlFor={`${id}-method`}>Method</label>
              <select id={`${id}-method`} value={method} onChange={(e) => { setMethod(e.target.value); }}>
                {(METHODS.includes(method) ? METHODS : [...METHODS, method]).map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="field field--grow">
              <label htmlFor={`${id}-url`}>URL</label>
              <input id={`${id}-url`} type="text" inputMode="url" spellCheck={false} required value={url}
                onChange={(e) => { setUrl(e.target.value); }} placeholder="https://api-eu.dhl.com/track/shipments?trackingNumber=…" />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${id}-headers`}>Headers <span className="hint">one per line, Name: value</span></label>
            <textarea id={`${id}-headers`} rows={3} spellCheck={false} value={headers} onChange={(e) => { setHeaders(e.target.value); }} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-body`}>Body</label>
            <textarea id={`${id}-body`} rows={8} spellCheck={false} value={body} onChange={(e) => { setBody(e.target.value); }} />
          </div>
          <button type="submit" className="primary">Check request</button>
        </form>
      </section>

      <section aria-labelledby={`${id}-results`} className="card results">
        <h2 id={`${id}-results`}>Findings</h2>
        <p role="status" className="visually-hidden">{checked ? summarise(checked.diagnosis, stale) : ''}</p>
        {checked ? (
          <>
            {stale && <p className="stale">You've changed the request since this check. Choose Check request to update the findings.</p>}
            <DetectionSummary detection={checked.diagnosis.detection} />
            <FindingsList findings={checked.diagnosis.findings} />
            <div className="curl-out">
              <h3>As a curl command</h3>
              <pre tabIndex={0} aria-label="curl command"><code>{toCurl(checked.request)}</code></pre>
              <CopyButton text={toCurl(checked.request)} label="Copy curl command" />
            </div>
          </>
        ) : (
          <p className="hint">Enter a request, or pick an example, then choose Check request.</p>
        )}
      </section>
    </div>
  );
}

/** The short line screen readers announce, instead of reading out every finding. */
function summarise(diagnosis: Diagnosis, stale: boolean): string {
  if (stale) return 'The findings are for an earlier version of the request.';
  const count = diagnosis.findings.length;
  return count === 0 ? 'Checked: no problems found.' : `Checked: ${count} finding${count === 1 ? '' : 's'}.`;
}
