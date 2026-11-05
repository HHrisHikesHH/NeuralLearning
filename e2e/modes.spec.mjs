// Mode-based ingestion in the real UI: Explorer 1 input, Practitioner 2, Researcher 3.
import { test, expect, setupVault, sampleMap, paste, fakeFiles, fakeRead } from './helpers.mjs';
import { loadMapFromObject, toNCF } from '../js/core/ncf.js';
import { splitBatches, topicSlug } from '../js/core/multipart.js';
import { modeFor } from '../js/core/modes.js';

const FULL = sampleMap();

/** The AI responses for a depth, as the text the owner would paste. */
function responsesFor(depth) {
  const full = { ...FULL, depth };
  const mode = modeFor(depth);
  if (mode.parts === 1) return [JSON.stringify(toNCF(full))];
  const skeleton = toNCF({ ...full, nodes: full.nodes.map((n) => ({ ...n, additionalInfo: '', analogy: null })) });
  const skMap = loadMapFromObject(skeleton).data;
  const split = splitBatches(skMap, mode.batches);
  const byId = new Map(full.nodes.map((n) => [n.id, n]));
  const nce = (batch) => JSON.stringify({
    _nce: '1', _id: `${topicSlug(skMap.topic)}_${depth}`, batch, E_cols: ['ni', 'desc', 'info', 'analogy'],
    E: split[`batch${batch}`].map((n) => { const f = byId.get(n.id); return [f.id, f.description, f.additionalInfo, f.analogy]; }),
  });
  return [JSON.stringify(skeleton), ...Array.from({ length: mode.batches }, (_, i) => nce(i + 1))];
}

async function startImport(page, depth) {
  await page.goto('/tests/e2e.html#/new');
  await page.locator(`[data-depth=${depth}]`).click();
  await page.getByRole('button', { name: /Already have JSON/ }).click();
  await expect(page).toHaveURL(/#\/build$/);
}

async function startGenerate(page, depth, topic = 'Buddhism') {
  await page.goto('/tests/e2e.html#/new');
  await page.locator('#topic-input').fill(topic);
  await page.locator(`[data-depth=${depth}]`).click();
  await page.getByRole('button', { name: /Generate knowledge prompt/ }).click();
  await expect(page).toHaveURL(/#\/build$/);
}

const progress = (page) => page.locator('#parts-progress');
const slotInputs = (page) => page.locator('.mp-slot textarea');

test('explorer: exactly one input, 1/1 when valid', async ({ page }) => {
  await setupVault(page);
  await startImport(page, 'explorer');
  await expect(page.locator('textarea')).toHaveCount(1);
  await expect(page.locator('.mp-slot')).toHaveCount(0);
  await expect(progress(page)).toHaveText('0/1 complete');
  await paste(page.locator('#json-paste'), '{"broken": ');
  await expect(page.locator('#val-msg')).toContainText('Map JSON: Invalid JSON');
  await paste(page.locator('#json-paste'), responsesFor('explorer')[0]);
  await expect(progress(page)).toHaveText('1/1 complete');
  await expect(page.getByRole('button', { name: /Visualise knowledge graph/ })).toBeEnabled();
});

test('practitioner import: two inputs, per-part errors, progress, then save and share', async ({ page }) => {
  await setupVault(page);
  await startImport(page, 'practitioner');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import a 2-part Practitioner map');
  await expect(slotInputs(page)).toHaveCount(2);
  await expect(page.locator('.mp-slot .card-title')).toHaveText(['Skeleton JSON', 'Data Part JSON']);
  await expect(progress(page)).toHaveText('0/2 complete');

  const [skeleton, data] = responsesFor('practitioner');
  await paste(slotInputs(page).nth(1), '{"_nce": "1", "E": [');
  await expect(page.locator('.mp-slot').nth(1)).toContainText('Data Part: invalid JSON');
  await paste(slotInputs(page).nth(0), skeleton);
  await expect(progress(page)).toHaveText('1/2 complete');
  await expect(page.locator('#parts-line')).toHaveText('1 of 2 parts valid · still needed: Data Part');
  await expect(page.getByRole('button', { name: /Visualise/ })).toBeDisabled();

  await paste(slotInputs(page).nth(1), data);
  await expect(progress(page)).toHaveText('2/2 complete');
  await expect(page.locator('#parts-line')).toHaveText('✓ Map ready — all 2 parts valid');
  await page.getByRole('button', { name: /Visualise full graph/ }).click();
  await expect(page).toHaveURL(/#\/draft$/);
  await expect(page.locator('svg circle').first()).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('Saved');
  const id = (await page.evaluate(() => location.hash)).replace('#/map/', '');
  expect(await fakeRead(page, 'NeuronVault', `maps/${id}.enc`)).toContain('"neuron":"enc"');

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('checkbox').check();
  await dlg.getByRole('button', { name: 'Publish publicly' }).click();
  await expect(dlg.getByRole('button', { name: 'Unpublish' })).toBeVisible({ timeout: 30_000 });
  const snapPath = (await fakeFiles(page, 'NeuronShares')).find((f) => /^s\/[^/]+\/map\.json$/.test(f));
  const snap = loadMapFromObject(JSON.parse(await fakeRead(page, 'NeuronShares', snapPath)).map);
  expect(snap.ok).toBe(true);
  expect(snap.data.nodes.every((n) => n.additionalInfo.length > 0)).toBe(true);
});

test('researcher import: three inputs, swapped data parts are caught, then a complete map', async ({ page }) => {
  await setupVault(page);
  await startImport(page, 'researcher');
  await expect(slotInputs(page)).toHaveCount(3);
  const [skeleton, a, b] = responsesFor('researcher');
  await paste(slotInputs(page).nth(0), skeleton);
  await paste(slotInputs(page).nth(1), b);
  await paste(slotInputs(page).nth(2), a);
  await expect(page.locator('.mp-slot').nth(1)).toContainText('paste it into Data Part 2');
  await expect(page.locator('.mp-slot').nth(2)).toContainText('paste it into Data Part 1');
  await expect(progress(page)).toHaveText('1/3 complete');
  await paste(slotInputs(page).nth(1), a);
  await paste(slotInputs(page).nth(2), b);
  await expect(progress(page)).toHaveText('3/3 complete');
  await page.getByRole('button', { name: /Visualise full graph/ }).click();
  await expect(page.locator('svg circle').first()).toBeVisible();
});

test('researcher generate: sequential prompts, progressive launch, ← Build keeps the parts', async ({ page }) => {
  await setupVault(page);
  await startGenerate(page, 'researcher');
  await expect(slotInputs(page)).toHaveCount(3);
  await expect(page.locator('.mp-slot pre').nth(0)).toContainText('SKELETON ONLY (Part 1 of 3)');
  await expect(slotInputs(page).nth(1)).toBeDisabled();
  const [skeleton, a] = responsesFor('researcher');
  await paste(slotInputs(page).nth(0), skeleton);
  await expect(page.locator('.mp-slot pre').nth(1)).toContainText('(Part 2 of 3 · Batch 1 of 2)');
  await expect(slotInputs(page).nth(1)).toBeEnabled();
  await expect(slotInputs(page).nth(2)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Visualise skeleton' })).toBeEnabled();
  await paste(slotInputs(page).nth(1), a);
  await expect(progress(page)).toHaveText('2/3 complete');
  const launch = page.getByRole('button', { name: /Visualise \(40\/79 enriched\)/ });
  await launch.click();
  await expect(page).toHaveURL(/#\/draft$/);
  await page.getByRole('link', { name: '← Build' }).click();
  await expect(page).toHaveURL(/#\/build$/);
  await expect(progress(page)).toHaveText('2/3 complete');
  await expect(slotInputs(page).nth(2)).toBeEnabled();
});

test('practitioner generate: 2-part prompts', async ({ page }) => {
  await setupVault(page);
  await startGenerate(page, 'practitioner');
  await expect(slotInputs(page)).toHaveCount(2);
  await expect(page.locator('.mp-slot pre').nth(0)).toContainText('SKELETON ONLY (Part 1 of 2)');
  await paste(slotInputs(page).nth(0), responsesFor('practitioner')[0]);
  await expect(page.locator('.mp-slot pre').nth(1)).toContainText('(Part 2 of 2 · Batch 1 of 1)');
  await expect(page.locator('.mp-slot pre').nth(1)).toContainText('enriching 79 of 79 nodes');
  await page.getByRole('button', { name: 'Paste existing responses' }).click();
  await expect(page.locator('.mp-slot pre').first()).toBeHidden();
  await expect(slotInputs(page).nth(0)).toHaveValue(/"_ncf"/);
});

test('switching between single JSON and multi-part import shows exactly N inputs', async ({ page }) => {
  await setupVault(page);
  await startImport(page, 'explorer');
  await page.getByRole('button', { name: 'Import 2 parts (Practitioner)' }).click();
  await expect(slotInputs(page)).toHaveCount(2);
  await expect(progress(page)).toHaveText('0/2 complete');
  await page.getByRole('button', { name: 'Paste a single JSON' }).click();
  await expect(page.locator('textarea')).toHaveCount(1);
  await page.getByRole('button', { name: 'Import 3 parts (Researcher)' }).click();
  await expect(slotInputs(page)).toHaveCount(3);
});

test('mobile: the three-part screen fits a 375px phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupVault(page);
  await startImport(page, 'researcher');
  await expect(slotInputs(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
