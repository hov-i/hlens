import { test, expect } from '@playwright/test';

test('{Feature name}', async ({ page }) => {
  await test.step('{First user action}', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading')).toBeVisible();
  });

  await test.step('{Second user action}', async () => {
    // await page.getByRole('button', { name: '...' }).click();
  });
});
