import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.js';

describe('App', () => {
  it('checks an example request in the browser', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tracking with a Bearer token' }));
    const results = screen.getByRole('region', { name: 'Findings' });
    expect(within(results).getByRole('heading', { name: /No DHL-API-Key header/ })).toBeInTheDocument();
    expect(within(results).getByText('Shipment Tracking – Unified')).toBeInTheDocument();
  });

  it('reads a pasted curl command into the form', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Paste a curl command instead'));
    await user.type(screen.getByLabelText('curl command'), "curl 'https://api-eu.dhl.com/track/shipments?trackingNumber=1' -H 'DHL-API-Key: demo-key'");
    await user.click(screen.getByRole('button', { name: 'Read command' }));
    expect(screen.getByLabelText('URL')).toHaveValue('https://api-eu.dhl.com/track/shipments?trackingNumber=1');
    expect(screen.getByRole('heading', { name: /demo-key returns mocked data/ })).toBeInTheDocument();
  });

  it('marks findings as out of date when the request is edited', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tracking with a Bearer token' }));
    expect(screen.queryByText(/You've changed the request/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('URL'), '&service=express');
    expect(screen.getByText(/You've changed the request/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check request' }));
    expect(screen.queryByText(/You've changed the request/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Checked: \d+ findings?\.$/)).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Check a request' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Explain an error' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Explain an error' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'MyDHL: 998 date format' }));
    expect(screen.getByRole('heading', { name: /Planned shipping time is not in DHL's format/ })).toBeInTheDocument();
  });
});
