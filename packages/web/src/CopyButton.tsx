import { useState } from 'react';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <button type="button" onClick={() => { void copy(); }}>{label}</button>
      <span role="status" className="hint copy-status">
        {state === 'copied' ? 'Copied.' : state === 'failed' ? 'Copy failed: select the text and copy it instead.' : ''}
      </span>
    </>
  );
}
