import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGitHub } from './helpers/fake-github.mjs';
import { createGitHub } from '../js/owner/github.js';
import { createVault, initialiseVault } from '../js/owner/vault.js';
import { createShares } from '../js/owner/shares.js';
import { renderSharePage, escapeHtml } from '../js/owner/share-page.js';
import { createKeyring } from '../js/owner/crypto.js';
import { loadMapFromText, loadMapFromObject } from '../js/core/ncf.js';

const SAMPLE = loadMapFromText(readFileSync(new URL('../sample.json', import.meta.url), 'utf8')).data;
const EVIL = loadMapFromText(readFileSync(new URL('./fixtures/malicious.json', import.meta.url), 'utf8')).data;
const ID = 'AbCdEfGhIjKlMnOpQrStUv';

async function setup() {
  const fake = createFakeGitHub();
  fake.repo('NeuronVault');
  fake.repo('NeuronShares');
  const gh = createGitHub(fake.token, { fetchImpl: fake.fetchImpl, retryDelays: [1] });
  const { keyring, key } = await createKeyring('correct horse battery staple', 100_000);
  await initialiseVault(gh, keyring, key);
  const vault = createVault(gh, key);
  await vault.refresh();
  const image = async () => ({ base64: Buffer.from('PNGDATA').toString('base64'), ext: 'png', mime: 'image/png' });
  return { fake, gh, vault, shares: createShares(gh, vault, { renderImage: image }) };
}

test('share page escapes every map-controlled value and carries static OG tags', () => {
  const html = renderSharePage({ shareId: ID, title: '"><script>alert(1)</script>', map: EVIL, imageFile: 'og.png' });
  assert.equal(html.includes('<script>alert'), false);
  assert.equal(/<img src=x/i.test(html), false);
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:image']) assert.ok(html.includes(`"${tag}"`), tag);
  assert.ok(html.includes(`content="https://hhrishikeshh.github.io/NeuronShares/s/${ID}/og.png"`));
  assert.ok(html.includes('content="summary_large_image"'));
  assert.ok(html.includes("connect-src 'self'"));
  assert.equal((html.match(/<script/g) || []).length, 2, 'only d3 and the viewer module');
  assert.throws(() => renderSharePage({ shareId: '../../x', title: 't', map: SAMPLE }));
  assert.equal(escapeHtml(`<a href='x'>&\``), '&lt;a href=&#39;x&#39;&gt;&amp;&#96;');
});

test('saving a map never publishes anything', async () => {
  const { fake, vault } = await setup();
  await vault.saveMap({ title: 'Private', map: SAMPLE });
  assert.deepEqual(fake.files('NeuronShares'), []);
});

test('publish writes one folder, records the share in the vault, and the snapshot is loadable', async () => {
  const { fake, vault, shares } = await setup();
  const mapId = await vault.saveMap({ title: 'Buddhism map', map: SAMPLE });
  await vault.setProgress(mapId, ['buddha']);
  const r = await shares.publish(vault.entry(mapId), SAMPLE);
  const files = fake.files('NeuronShares');
  assert.deepEqual(files, ['.nojekyll', 'index.html', `s/${r.id}/index.html`, `s/${r.id}/map.json`, `s/${r.id}/og.png`]);
  assert.equal(r.url, `https://hhrishikeshh.github.io/NeuronShares/s/${r.id}/`);
  const snap = JSON.parse(fake.readDirect('NeuronShares', `s/${r.id}/map.json`));
  assert.equal(snap.neuronShare, 1);
  assert.equal(snap.title, 'Buddhism map');
  assert.deepEqual(loadMapFromObject(snap.map).data, SAMPLE);
  const text = JSON.stringify(snap);
  assert.equal(text.includes(mapId), false, 'vault map id is not exposed');
  assert.deepEqual(Object.keys(snap).sort(), ['map', 'neuronShare', 'publishedAt', 'title', 'updatedAt'], 'only public fields: no progress, ids or vault metadata');
  const e = vault.list()[0];
  assert.equal(e.share.status, 'published');
  assert.equal(e.share.id, r.id);
});

test('republishing keeps the same link; unpublishing removes the folder and the record', async () => {
  const { fake, vault, shares } = await setup();
  const mapId = await vault.saveMap({ title: 'A', map: SAMPLE });
  const first = await shares.publish(vault.entry(mapId), SAMPLE);
  await vault.renameMap(mapId, 'A renamed');
  const second = await shares.publish(vault.entry(mapId), SAMPLE, { title: 'A renamed' });
  assert.equal(second.id, first.id);
  assert.equal(JSON.parse(fake.readDirect('NeuronShares', `s/${first.id}/map.json`)).title, 'A renamed');
  await shares.unpublish(vault.entry(mapId));
  assert.deepEqual(fake.files('NeuronShares').filter((f) => f.startsWith('s/')), []);
  assert.equal(vault.entry(mapId).share, null);
});

test('two published maps get different unpredictable ids', async () => {
  const { vault, shares } = await setup();
  const a = await shares.publish(vault.entry(await vault.saveMap({ title: 'A', map: SAMPLE })), SAMPLE);
  const b = await shares.publish(vault.entry(await vault.saveMap({ title: 'B', map: SAMPLE })), SAMPLE);
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^[A-Za-z0-9_-]{22}$/);
});

test('an interrupted publish is reconciled on the next unlock', async () => {
  const { fake, vault, shares } = await setup();
  const mapId = await vault.saveMap({ title: 'A', map: SAMPLE });
  fake.fault({ method: 'POST', match: /NeuronShares\/git\/commits$/, status: 500 });
  await assert.rejects(shares.publish(vault.entry(mapId), SAMPLE));
  assert.equal(vault.entry(mapId).share.status, 'publishing');
  await shares.reconcile(vault.list());
  assert.equal(vault.entry(mapId).share, null, 'nothing went live, so the half-done share is cleared');

  const r = await shares.publish(vault.entry(mapId), SAMPLE);
  await vault.setShare(mapId, { ...vault.entry(mapId).share, status: 'publishing' });
  await shares.reconcile(vault.list());
  assert.equal(vault.entry(mapId).share.status, 'published');
  assert.equal(vault.entry(mapId).share.id, r.id);
});

test('a map that fails to render a preview image still publishes', async () => {
  const { fake, gh, vault } = await setup();
  const shares = createShares(gh, vault, { renderImage: async () => { throw new Error('no canvas'); } });
  const r = await shares.publish(vault.entry(await vault.saveMap({ title: 'A', map: SAMPLE })), SAMPLE);
  assert.ok(fake.files('NeuronShares').includes(`s/${r.id}/index.html`));
  const html = fake.readDirect('NeuronShares', `s/${r.id}/index.html`);
  assert.ok(html.includes('content="https://hhrishikeshh.github.io/NeuralLearning/assets/og-default.jpg"'), 'falls back to the default card');
  assert.ok(html.includes('content="image/jpeg"'));
});
