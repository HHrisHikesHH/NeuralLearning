// Shared helpers for the browser smoke tests.
//
// Safety: tests/e2e-boot.js answers every GitHub request from an in-browser fake before it reaches
// the network. As a second line of defence, any request that still tries to leave for the real
// GitHub API or the real Pages origin is aborted and recorded, and the test fails. CI never has a
// GitHub token; the only credentials used are the fake's test values exposed as window.__e2e.
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loadMapFromText, loadMapFromObject, toNCF } from '../js/core/ncf.js';

export const test = base.extend({
  page: async ({ page }, use) => {
    const escaped = [];
    for (const pattern of ['https://api.github.com/**', 'https://hhrishikeshh.github.io/**']) {
      await page.route(pattern, (route) => { escaped.push(route.request().url()); return route.abort(); });
    }
    // Fonts are cosmetic; skip them to keep runs fast and independent of Google's servers.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    expect(escaped, 'no request may reach the real GitHub').toEqual([]);
    expect(errors, 'no uncaught page errors').toEqual([]);
  },
});
export { expect };

/** The real 79-concept sample map, normalised, with explanations filled in. */
export function sampleMap() {
  const s = loadMapFromText(readFileSync(new URL('../sample.json', import.meta.url), 'utf8')).data;
  return loadMapFromObject(toNCF({
    ...s,
    nodes: s.nodes.map((n, i) => ({ ...n, additionalInfo: `${n.label} explained.\n\nHow it fits the map (${i}).`, analogy: i % 3 ? null : `Like ${n.label}` })),
  })).data;
}

/** Fresh fake vault: unlock with the fake token, create the vault, confirm the recovery code. */
export async function setupVault(page) {
  await page.goto('/tests/e2e.html');
  const creds = await page.evaluate(() => window.__e2e);
  await page.getByPlaceholder(/github_pat_/).fill(creds.token);
  await page.locator('#view input[type=password]').nth(1).fill(creds.passphrase);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('Set up your vault')).toBeVisible();
  const pw = page.locator('#view input[type=password]');
  for (let i = 0; i < await pw.count(); i++) await pw.nth(i).fill(creds.passphrase);
  await page.getByRole('button', { name: /Create encrypted vault/ }).click();
  await expect(page.getByText('Save your recovery code')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Continue to My Maps/ }).click();
  await expect(page).toHaveURL(/#\/maps$/);
}

/** Set a textarea's value in one step (typing 50 kB of JSON key by key is needlessly slow). */
export async function paste(locator, text) {
  await locator.fill(text);
}

export const fakeFiles = (page, repo) => page.evaluate((r) => window.__fake.files(r), repo);
export const fakeRead = (page, repo, path) => page.evaluate(([r, p]) => window.__fake.readDirect(r, p), [repo, path]);
