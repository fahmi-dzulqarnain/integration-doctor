import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ProbePanel } from './ProbePanel.js';
import { RequestPanel } from './RequestPanel.js';
import { ResponsePanel } from './ResponsePanel.js';

const TABS = [
  { id: 'check', label: 'Check a request', Panel: RequestPanel },
  { id: 'explain', label: 'Explain an error', Panel: ResponsePanel },
  { id: 'live', label: 'Live demo-key call', Panel: ProbePanel },
] as const;

type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const hash = window.location.hash.slice(1);
  return TABS.find((tab) => tab.id === hash)?.id ?? 'check';
}

export function App() {
  const [active, setActive] = useState<TabId>(tabFromHash);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  useEffect(() => {
    const onHash = () => { setActive(tabFromHash()); };
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('hashchange', onHash); };
  }, []);

  function select(id: TabId, focus = false) {
    setActive(id);
    window.history.replaceState(null, '', `#${id}`);
    if (focus) tabRefs.current.get(id)?.focus();
  }

  // Arrow keys move between tabs, as the WAI-ARIA tabs pattern expects.
  function onKeyDown(event: KeyboardEvent) {
    const index = TABS.findIndex((tab) => tab.id === active);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const tab = TABS[(next + TABS.length) % TABS.length];
    if (tab) select(tab.id, true);
  }

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <h1>Integration Doctor <span>for DHL APIs</span></h1>
          <p>Check a DHL API request before you send it, and get DHL's errors explained, each with its source.</p>
        </div>
      </header>

      <main className="wrap">
        <div role="tablist" aria-label="Tools" className="tabs" onKeyDown={onKeyDown}>
          {TABS.map((tab) => (
            <button key={tab.id} type="button" role="tab" id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`}
              aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1}
              ref={(el) => { if (el) tabRefs.current.set(tab.id, el); else tabRefs.current.delete(tab.id); }}
              onClick={() => { select(tab.id); }}>
              {tab.label}
            </button>
          ))}
        </div>
        {TABS.map(({ id, Panel }) => (
          <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={active !== id}>
            <Panel />
          </div>
        ))}
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <p>
            Not affiliated with, endorsed by, or sponsored by DHL or Deutsche Post DHL Group. “DHL” is their trademark and
            is used here only to say which APIs this tool works with.
          </p>
          <p><a href="/api/docs">HTTP API</a> · Checks are fixed rules with cited sources; no AI decides a finding.</p>
        </div>
      </footer>
    </>
  );
}
