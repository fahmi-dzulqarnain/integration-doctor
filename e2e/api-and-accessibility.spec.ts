import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('HTTP API through nginx', () => {
  test('diagnoses a request', async ({ request }) => {
    const res = await request.post('/api/diagnose', {
      data: { method: 'GET', url: 'https://xmlpi-ea.dhl.com/XMLShippingServlet' },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { detection: { api: string }; findings: { ruleId: string }[] };
    expect(body.detection.api).toBe('legacy-express');
    expect(body.findings.map((f) => f.ruleId)).toContain('host.legacy-express');
  });

  test('refuses a user\'s own key on the probe', async ({ request }) => {
    const res = await request.post('/api/probe/tracking', { data: { trackingNumber: '00340434292135100186', apiKey: 'mine' } });
    expect(res.status()).toBe(400);
  });

  test('serves the OpenAPI docs and security headers', async ({ request }) => {
    expect((await request.get('/api/docs')).status()).toBe(200);
    const page = await request.get('/');
    expect(page.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(page.headers()['x-content-type-options']).toBe('nosniff');
  });
});

test.describe('Accessibility', () => {
  for (const [tab, example] of [
    ['check', 'MyDHL shipment with an ISO date'],
    ['explain', 'MyDHL: 996 pickup date'],
  ] as const) {
    test(`#${tab} has no WCAG A or AA violations with results shown`, async ({ page }) => {
      await page.goto(`/#${tab}`);
      await page.getByRole('button', { name: example }).click();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)})`)).toEqual([]);
    });
  }
});
