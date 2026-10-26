import { expect, test } from '@playwright/test';

// In Compose the API calls e2e/dhl-stub.mjs, paced at one call every 4 s (PROBE_INTERVAL_MS).
test.describe.serial('Live demo-key call', () => {
  test('shows DHL\'s answer and the checks on the request', async ({ page }) => {
    await page.goto('/#live');
    await page.getByRole('button', { name: 'Call DHL' }).click();

    const answer = page.getByRole('region', { name: "DHL's answer" });
    await expect(answer.getByText('HTTP 200', { exact: true })).toBeVisible();
    await expect(answer.getByText(/GET http:\/\/dhl-stub:8081\/track\/shipments\?trackingNumber=00340434292135100186/)).toBeVisible();
    await expect(answer.getByText('DELIVERED (stub)')).toBeVisible();
    await expect(answer.getByText(/demo-key calls left today/)).toBeVisible();
  });

  test('tells the user to wait when calls come too fast', async ({ page }) => {
    await page.goto('/#live');
    await page.getByRole('button', { name: 'Call DHL' }).click();
    await expect(page.getByRole('alert')).toContainText('DHL allows one demo-key call every few seconds');
  });

  test('explains an error answer', async ({ page }) => {
    await page.waitForTimeout(4500);
    await page.goto('/#live');
    await page.getByLabel('Tracking number').fill('UNAUTHORISED');
    await page.getByRole('button', { name: 'Call DHL' }).click();

    const answer = page.getByRole('region', { name: "DHL's answer" });
    await expect(answer.getByText('HTTP 401', { exact: true })).toBeVisible();
    await expect(answer.getByText('DHL said:')).toContainText('Unauthorized for given resource.');
  });
});
