// Smoke tests for the owner app and the public viewer, against the in-browser fake GitHub.
import { test, expect, setupVault, sampleMap, paste, fakeFiles, fakeRead } from './helpers.mjs';
import { toNCF, loadMapFromObject } from '../js/core/ncf.js';

const MAP = sampleMap();
const SINGLE_JSON = JSON.stringify(toNCF(MAP));

async function buildExplorerMap(page) {
  await page.goto('/tests/e2e.html#/new');
  await page.locator('#topic-input').fill('Buddhism');
  await page.getByRole('button', { name: /Generate knowledge prompt/ }).click();
  await expect(page.locator('pre.prompt-box').first()).toContainText('TOPIC:     Buddhism');
  await paste(page.locator('#json-paste'), SINGLE_JSON);
  await expect(page.locator('#val-msg')).toContainText('✓ Valid — 79 concepts · 88 links');
  await page.getByRole('button', { name: /Visualise knowledge graph/ }).click();
  await expect(page).toHaveURL(/#\/draft$/);
  await expect(page.locator('svg circle').first()).toBeVisible();
}

async function save(page, title) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('input').fill(title);
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('Saved');
  const id = (await page.evaluate(() => location.hash)).replace('#/map/', '');
  expect(id).toMatch(/^[A-Za-z0-9_-]{10,}$/);
  return id;
}

test('fresh vault: set up, recovery code, empty library', async ({ page }) => {
  await setupVault(page);
  await expect(page.getByRole('heading', { name: /My maps/ })).toBeVisible();
  expect(await fakeFiles(page, 'NeuronVault')).toEqual(['README.md', 'keyring.json', 'manifest.enc']);
});

test('explorer: one JSON response → visualise → save encrypted → reopen from My maps', async ({ page }) => {
  await setupVault(page);
  await buildExplorerMap(page);
  const id = await save(page, 'Smoke map');

  const raw = await fakeRead(page, 'NeuronVault', `maps/${id}.enc`);
  expect(raw).toContain('"neuron":"enc"');
  expect(raw).not.toContain(MAP.nodes[0].label);

  await page.goto('/tests/e2e.html#/maps');
  await page.getByRole('link', { name: 'Smoke map' }).click();
  await expect(page.locator('.mv-topic')).toHaveText(/Smoke map/i);
  await expect(page.locator('svg circle').first()).toBeVisible();
});

test('share: consent required, snapshot is a loadable map with no vault metadata', async ({ page }) => {
  await setupVault(page);
  await buildExplorerMap(page);
  await save(page, 'Shared smoke map');

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dlg = page.getByRole('dialog');
  const publish = dlg.getByRole('button', { name: 'Publish publicly' });
  await expect(publish).toBeDisabled();
  await dlg.getByRole('checkbox').check();
  await publish.click();
  await expect(dlg.getByRole('button', { name: 'Unpublish' })).toBeVisible({ timeout: 30_000 });

  const files = await fakeFiles(page, 'NeuronShares');
  const snapPath = files.find((f) => /^s\/[^/]+\/map\.json$/.test(f));
  expect(snapPath).toBeTruthy();
  const snap = JSON.parse(await fakeRead(page, 'NeuronShares', snapPath));
  expect(Object.keys(snap).sort()).toEqual(['map', 'neuronShare', 'publishedAt', 'title', 'updatedAt']);
  const opened = loadMapFromObject(snap.map);
  expect(opened.ok).toBe(true);
  expect(opened.data.nodes).toHaveLength(MAP.nodes.length);
});

test('public viewer opens a shared map read-only', async ({ page }) => {
  await page.goto('/view.html?s=TestShareId0000000000A');
  await expect(page.locator('svg circle').first()).toBeVisible();
  await expect(page.getByText(/Buddhism/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Share/ })).toHaveCount(0);
});

test('public viewer renders the malicious fixture as text only', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.goto('/view.html?s=MaliciousShare0000000B');
  await expect(page.locator('svg circle').first()).toBeVisible();
  expect(await page.locator('#view script, #view img[src="x"], #view iframe').count()).toBe(0);
  expect(dialogs).toBe(0);
});
