import { expect, test } from '@playwright/test';

test.describe('Explain an error', () => {
  test('matches a pasted Tracking 401 against the catalogue', async ({ page }) => {
    await page.goto('/#explain');
    await page.getByLabel('Status').fill('401');
    await page.getByLabel(/Request URL/).fill('https://api-eu.dhl.com/track/shipments?trackingNumber=1');
    await page.getByLabel('Response body').fill('{"status":401,"title":"Unauthorized","detail":"Unauthorized for given resource."}');
    await page.getByRole('button', { name: 'Explain error' }).click();

    const explanation = page.getByRole('region', { name: 'Explanation' });
    await expect(explanation.getByText('DHL said:')).toContainText('Unauthorized for given resource.');
    await expect(explanation.getByRole('heading', { level: 4, name: 'Fixes' })).toBeVisible();
    await expect(explanation.getByText('Shipment Tracking – Unified', { exact: true })).toBeVisible();
  });

  test('names the field in a MyDHL schema error', async ({ page }) => {
    await page.goto('/#explain');
    await page.getByRole('button', { name: 'MyDHL: address line too long' }).click();
    const explanation = page.getByRole('region', { name: 'Explanation' });
    await expect(explanation.getByText('customerDetails.shipperDetails.postalAddress.addressLine1')).toBeVisible();
  });
});

test.describe('Navigation', () => {
  test('tabs work with the keyboard and the address bar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Check a request' }).focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Live demo-key call' })).toBeFocused();
    await expect(page).toHaveURL(/#live$/);
    await expect(page.getByRole('heading', { name: "Live call with DHL's demo-key" })).toBeVisible();

    await page.goto('/#explain');
    await expect(page.getByRole('tab', { name: 'Explain an error' })).toHaveAttribute('aria-selected', 'true');
  });

  test('shows the disclaimer on every page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toContainText('Not affiliated with, endorsed by, or sponsored by DHL');
  });
});
