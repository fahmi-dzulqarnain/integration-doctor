import { expect, test } from '@playwright/test';

test.describe('Check a request', () => {
  test('explains an example request, with sources, and offers it as curl', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.getByRole('button', { name: 'Tracking with a Bearer token' }).click();

    const findings = page.getByRole('region', { name: 'Findings' });
    await expect(findings.getByText('Shipment Tracking – Unified', { exact: true })).toBeVisible();
    const finding = findings.getByRole('listitem').filter({ hasText: 'No DHL-API-Key header' });
    await expect(finding.getByText('Error', { exact: true })).toBeVisible();
    await expect(finding.getByRole('link').first()).toHaveAttribute('href', /developer\.dhl\.com/);

    await findings.getByRole('button', { name: 'Copy curl command' }).click();
    await expect(findings.getByText('Copied.')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe("curl 'https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186' -H 'Authorization: Bearer your-api-key'");
  });

  test('reads a pasted curl command and finds MyDHL schema and date problems', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Paste a curl command instead').click();
    await page.getByLabel('curl command').fill(String.raw`curl -X POST 'https://express.api.dhl.com/mydhlapi/test/shipments?validateDataOnly=true' \
  -u apiUser:apiPassword -H 'Content-Type: application/json' -H 'x-version: 3.4.0' \
  --data-raw '{"plannedShippingDateAndTime":"2026-11-02T10:00:00Z","productCode":"P"}'`);
    await page.getByRole('button', { name: 'Read command' }).click();

    await expect(page.getByLabel('Method')).toHaveValue('POST');
    await expect(page.getByLabel('Headers')).toHaveValue(/^Authorization: Basic /);
    const findings = page.getByRole('region', { name: 'Findings' });
    await expect(findings.getByRole('heading', { name: /plannedShippingDateAndTime is not a valid DHL date/ })).toBeVisible();
    await expect(findings.getByRole('heading', { name: /Missing customerDetails/ })).toBeVisible();
    await expect(findings.getByText('MyDHL API', { exact: true })).toBeVisible();
  });

  test('checks what the user typed into the form', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('URL', { exact: true }).fill('https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186&service=dhl-express');
    await page.getByLabel('Headers').fill('DHL-API-Key: demo-key');
    await page.getByRole('button', { name: 'Check request' }).click();
    await expect(page.getByRole('heading', { name: /"dhl-express" is not a Shipment Tracking service/ })).toBeVisible();
  });

  test('keeps the page within the screen on a phone @responsive', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'MyDHL shipment with an ISO date' }).click();
    await expect(page.getByRole('region', { name: 'Findings' }).getByRole('listitem').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
