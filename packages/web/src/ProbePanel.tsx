import { TRACKING_SERVICES, type Diagnosis, type Explanation } from '@integration-doctor/rules';
import { useId, useState } from 'react';
import { ExplanationView } from './ResponsePanel.js';
import { FindingsList } from './Results.js';

interface ProbeResult {
  request: { method: string; url: string; headers: Record<string, string> };
  response: { status: number; headers: Record<string, string>; body: string; truncated: boolean };
  diagnosis: Diagnosis;
  explanation?: Explanation;
  remainingToday: number;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: ProbeResult }
  | { kind: 'error'; message: string };

export function ProbePanel() {
  const id = useId();
  const [trackingNumber, setTrackingNumber] = useState('00340434292135100186');
  const [service, setService] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function probe() {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/probe/tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(service ? { trackingNumber: trackingNumber.trim(), service } : { trackingNumber: trackingNumber.trim() }),
      });
      const json: unknown = await res.json().catch(() => undefined);
      if (res.ok) {
        setState({ kind: 'done', result: json as ProbeResult });
        return;
      }
      setState({ kind: 'error', message: errorMessage(res.status, json) });
    } catch {
      setState({ kind: 'error', message: 'Could not reach the Integration Doctor API.' });
    }
  }

  return (
    <div className="panel-grid">
      <section aria-labelledby={`${id}-input`} className="card">
        <h2 id={`${id}-input`}>Live call with DHL's demo-key</h2>
        <p className="hint">
          Sends a real request to DHL Shipment Tracking with DHL's public <code>demo-key</code>, which answers with one fixed,
          mocked shipment. This site never asks for your own key: DHL's terms don't allow sharing it.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); void probe(); }}>
          <div className="field">
            <label htmlFor={`${id}-number`}>Tracking number</label>
            <input id={`${id}-number`} type="text" spellCheck={false} required pattern="[A-Za-z0-9\-]{4,64}"
              value={trackingNumber} onChange={(e) => { setTrackingNumber(e.target.value); }} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-service`}>Service <span className="hint">optional</span></label>
            <select id={`${id}-service`} value={service} onChange={(e) => { setService(e.target.value); }}>
              <option value="">Any</option>
              {TRACKING_SERVICES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <button type="submit" className="primary" disabled={state.kind === 'loading'}>
            {state.kind === 'loading' ? 'Calling DHL…' : 'Call DHL'}
          </button>
        </form>
      </section>

      <section aria-labelledby={`${id}-results`} className="card results">
        <p role="status" className="visually-hidden">
          {state.kind === 'loading' ? 'Calling DHL.' : state.kind === 'done' ? `DHL answered HTTP ${state.result.response.status}.` : ''}
        </p>
        <h2 id={`${id}-results`}>DHL's answer</h2>
        {state.kind === 'idle' && <p className="hint">Calls are paced to DHL's limits for the demo-key: one every few seconds.</p>}
        {state.kind === 'loading' && <p className="hint">Waiting for DHL…</p>}
        {state.kind === 'error' && <p role="alert" className="error-text">{state.message}</p>}
        {state.kind === 'done' && <ProbeView result={state.result} />}
      </section>
    </div>
  );
}

function ProbeView({ result }: { result: ProbeResult }) {
  const { response } = result;
  return (
    <>
      <p className="status-line">
        <span className={`badge ${response.status < 400 ? 'badge--ok' : 'badge--error'}`}>HTTP {response.status}</span>
        <code className="request-line">{result.request.method} {result.request.url}</code>
      </p>
      <p className="hint">{result.remainingToday} demo-key calls left today on this server.</p>
      {result.explanation && <ExplanationView explanation={result.explanation} />}
      <h3>Checks on the request</h3>
      <FindingsList findings={result.diagnosis.findings} />
      <h3>Response body{response.truncated ? ' (first 64 KB)' : ''}</h3>
      <pre className="response-body" tabIndex={0} aria-label="Response body"><code>{pretty(response.body)}</code></pre>
    </>
  );
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function errorMessage(status: number, json: unknown): string {
  if (typeof json === 'object' && json !== null) {
    const { message, retryAfterSeconds } = json as { message?: unknown; retryAfterSeconds?: unknown };
    const text = Array.isArray(message) ? message.join(' ') : typeof message === 'string' ? message : '';
    const wait = typeof retryAfterSeconds === 'number' ? ` (about ${retryAfterSeconds} s)` : '';
    if (text) return `${text}${wait}`;
  }
  return `The API answered ${status}.`;
}
