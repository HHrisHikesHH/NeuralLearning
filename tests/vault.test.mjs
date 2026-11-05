import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGitHub } from './helpers/fake-github.mjs';
import { createGitHub, GitHubError } from '../js/owner/github.js';
import { createVault, initialiseVault, restoreVault, PATH } from '../js/owner/vault.js';
import { createKeyring, unlockWithPassphrase, CryptoError } from '../js/owner/crypto.js';
import { loadMapFromText } from '../js/core/ncf.js';

const PASS = 'correct horse battery staple';
const IT = 100_000;
const SAMPLE = loadMapFromText(readFileSync(new URL('../sample.json', import.meta.url), 'utf8')).data;
function small(topic) {
  const nodes = SAMPLE.nodes.slice(0, 8).map((n) => ({ ...n, prerequisites: [] }));
  const links = nodes.slice(1).map((n, i) => ({ source: nodes[i].id, target: n.id, relation: 'enables', type: 'semantic', weight: 2, label: '' }));
  return { ...SAMPLE, topic, nodes, links, learningPath: nodes.map((n, i) => ({ nodeId: n.id, order: i + 1, phase: 'P', reason: 'r', estimatedMinutes: 5, keyInsight: 'k' })) };
}

async function setup({ largeThreshold } = {}) {
  const fake = createFakeGitHub({ largeThreshold });
  fake.repo('NeuronVault');
  const gh = createGitHub(fake.token, { fetchImpl: fake.fetchImpl, retryDelays: [1, 1] });
  const { keyring, key } = await createKeyring(PASS, IT);
  await initialiseVault(gh, keyring, key);
  return { fake, gh, key, keyring, vault: createVault(gh, key) };
}
const codeOf = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code || e.message; } };

test('empty repo is initialised; keyring and manifest are written; nothing is readable', async () => {
  const { fake } = await setup();
  assert.deepEqual(fake.files('NeuronVault'), ['README.md', 'keyring.json', 'manifest.enc']);
  const raw = fake.readDirect('NeuronVault', 'manifest.enc');
  assert.match(raw, /"neuron":"enc"/);
});

test('save → list → read → rename → progress → delete', async () => {
  const { vault, fake } = await setup();
  assert.deepEqual(await vault.refresh(), []);
  const id = await vault.saveMap({ title: 'My Buddhism map', map: SAMPLE });
  let list = vault.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'My Buddhism map');
  assert.equal(list[0].nodes, 79);
  const back = await vault.readMap(id);
  assert.deepEqual(back, SAMPLE);
  const raw = fake.readDirect('NeuronVault', PATH.map(id));
  assert.equal(/buddhism|Buddha/i.test(raw), false, 'map content is encrypted');
  assert.equal(/Buddhism/i.test(fake.readDirect('NeuronVault', 'manifest.enc')), false, 'title is encrypted');

  await vault.renameMap(id, '  Renamed\nmap  ');
  await vault.setProgress(id, ['buddha', 'dukkha', 'buddha']);
  list = await vault.refresh();
  assert.equal(list[0].title, 'Renamed map');
  assert.deepEqual(list[0].progress, ['buddha', 'dukkha']);

  await vault.deleteMap(id);
  assert.deepEqual(await vault.refresh(), []);
  assert.equal(fake.files('NeuronVault').includes(PATH.map(id)), false);
  assert.equal(await codeOf(vault.readMap(id)), 'not_found');
});

test('a second device can read what the first one saved', async () => {
  const { gh, keyring, vault } = await setup();
  const id = await vault.saveMap({ title: 'Cross-device', map: small('stoicism') });
  const key2 = await unlockWithPassphrase(keyring, PASS);
  const other = createVault(gh, key2);
  const list = await other.refresh();
  assert.equal(list[0].id, id);
  assert.equal((await other.readMap(id)).topic, 'stoicism');
});

test('concurrent saves from two devices: both survive, nothing is overwritten', async () => {
  const { fake, gh, key, vault } = await setup();
  const deviceB = createVault(gh, key);
  await deviceB.refresh();
  let interfered = false;
  fake.hooks.beforeRefUpdate = async () => {
    interfered = true;
    await deviceB.saveMap({ title: 'From device B', map: small('b') });
  };
  await vault.saveMap({ title: 'From device A', map: small('a') });
  assert.ok(interfered);
  const titles = (await vault.refresh()).map((m) => m.title).sort();
  assert.deepEqual(titles, ['From device A', 'From device B']);
  for (const e of fake.log.filter((l) => l.method === 'PATCH')) assert.equal(e.body.force, false, 'never force-updates the branch');
});

test('rename racing with a delete on another device fails cleanly instead of resurrecting the map', async () => {
  const { fake, gh, key, vault } = await setup();
  const id = await vault.saveMap({ title: 'Doomed', map: small('x') });
  const other = createVault(gh, key);
  fake.hooks.beforeRefUpdate = async () => { await other.deleteMap(id); };
  assert.equal(await codeOf(vault.renameMap(id, 'New name')), 'not_found');
  assert.deepEqual(await vault.refresh(), []);
});

test('persistent conflicts give up with a clear error and leave the library intact', async () => {
  const { fake, gh, key, vault } = await setup();
  const id = await vault.saveMap({ title: 'Keep me', map: small('k') });
  const other = createVault(gh, key);
  let n = 0;
  const interfere = async () => { n++; await other.setProgress(id, [`n${n}`]); if (n < 10) fake.hooks.beforeRefUpdate = interfere; };
  fake.hooks.beforeRefUpdate = interfere;
  const err = await vault.renameMap(id, 'never').catch((e) => e);
  fake.hooks.beforeRefUpdate = null;
  assert.equal(err.code, 'conflict');
  const list = await vault.refresh();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Keep me');
});

test('invalid maps are refused before anything is written', async () => {
  const { fake, vault } = await setup();
  const before = fake.head('NeuronVault');
  assert.equal(await codeOf(vault.saveMap({ title: 'bad', map: { ...SAMPLE, links: [] } })), 'bad_request');
  assert.equal(await codeOf(vault.saveMap({ id: '../escape', title: 'bad', map: SAMPLE })), 'bad_request');
  assert.equal(fake.head('NeuronVault'), before);
});

test('a failure part-way through a save changes nothing', async () => {
  const { fake, vault } = await setup();
  const id = await vault.saveMap({ title: 'Existing', map: small('e') });
  const before = fake.head('NeuronVault');
  fake.fault({ method: 'POST', match: /\/git\/trees$/, status: 500 });
  assert.equal(await codeOf(vault.saveMap({ title: 'New', map: small('n') })), 'server');
  fake.fault({ method: 'POST', match: /\/git\/blobs$/, network: true });
  assert.equal(await codeOf(vault.saveMap({ title: 'New', map: small('n') })), 'network');
  assert.equal(fake.head('NeuronVault'), before, 'branch untouched');
  assert.deepEqual((await vault.refresh()).map((m) => m.id), [id]);
});

test('reads retry transient errors; auth, permission and rate-limit errors are typed', async () => {
  const { fake, vault } = await setup();
  fake.fault({ method: 'GET', match: /\/git\/ref\/heads\/main$/, status: 502 });
  fake.fault({ method: 'GET', match: /\/git\/ref\/heads\/main$/, network: true });
  assert.deepEqual(await vault.refresh(), []);
  fake.fault({ method: 'GET', match: /\/git\/ref/, status: 403, headers: { 'x-ratelimit-remaining': '0' } });
  assert.equal(await codeOf(vault.refresh()), 'rate_limited');
  const badGh = createGitHub('github_pat_WRONGTOKEN000000000000', { fetchImpl: fake.fetchImpl, retryDelays: [1] });
  assert.equal(await codeOf(badGh.getRepo('NeuronVault')), 'unauthorized');
  assert.equal(await codeOf(badGh.getRepo('NoSuchRepo')), 'unauthorized');
  assert.throws(() => createGitHub('bad token!'), GitHubError);
  fake.repo('NeuronVault').push = false;
  assert.equal(await codeOf(vault.saveMap({ title: 'x', map: small('x') })), 'forbidden');
});

test('files over the inline size limit are read through the blob API', async () => {
  const { vault } = await setup({ largeThreshold: 2000 });
  const id = await vault.saveMap({ title: 'Big', map: SAMPLE });
  assert.equal((await vault.readMap(id)).nodes.length, 79);
});

test('a corrupted or tampered manifest is reported, never silently replaced', async () => {
  const { fake, vault } = await setup();
  await vault.saveMap({ title: 'A', map: small('a') });
  const good = fake.readDirect('NeuronVault', 'manifest.enc');
  const env = JSON.parse(good);
  env.ct = env.ct.slice(0, -4) + (env.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  fake.writeDirect('NeuronVault', { 'manifest.enc': JSON.stringify(env) });
  const err = await vault.refresh().catch((e) => e);
  assert.ok(err instanceof CryptoError);
  assert.equal(err.code, 'auth');
  assert.equal(await codeOf(vault.saveMap({ title: 'B', map: small('b') })), 'auth', 'refuses to write over an unreadable index');
  fake.writeDirect('NeuronVault', { 'manifest.enc': good });
  assert.equal((await vault.refresh()).length, 1);
});

test('a map file swapped onto another id is rejected (AAD binds path)', async () => {
  const { fake, vault } = await setup();
  const a = await vault.saveMap({ title: 'A', map: small('a') });
  const b = await vault.saveMap({ title: 'B', map: small('b') });
  fake.writeDirect('NeuronVault', { [PATH.map(b)]: fake.readDirect('NeuronVault', PATH.map(a)) });
  assert.equal(await codeOf(vault.readMap(b)), 'auth');
  assert.equal(await codeOf(vault.readMap('../../etc')), 'not_found');
});

test('initialising twice is refused', async () => {
  const { gh } = await setup();
  const { keyring, key } = await createKeyring(PASS, IT);
  assert.equal(await codeOf(initialiseVault(gh, keyring, key)), 'conflict');
});

test('backup → restore into a new empty vault → everything readable again', async () => {
  const { vault } = await setup();
  const id = await vault.saveMap({ title: 'Precious', map: SAMPLE });
  await vault.setProgress(id, ['buddha']);
  const backup = JSON.parse(JSON.stringify(await vault.exportBackup()));
  assert.equal(JSON.stringify(backup).includes('Precious'), false, 'backup stays encrypted');

  const fresh = createFakeGitHub();
  fresh.repo('NeuronVault');
  const gh2 = createGitHub(fresh.token, { fetchImpl: fresh.fetchImpl });
  await restoreVault(gh2, backup);
  const key = await unlockWithPassphrase(backup.keyring, PASS);
  const restored = createVault(gh2, key);
  const list = await restored.refresh();
  assert.equal(list[0].title, 'Precious');
  assert.deepEqual(list[0].progress, ['buddha']);
  assert.deepEqual(await restored.readMap(id), SAMPLE);
});

test('importing a backup merges: adds missing maps, keeps newer local ones', async () => {
  const { vault, key } = await setup();
  const keepId = await vault.saveMap({ title: 'Old title', map: small('k') });
  const goneId = await vault.saveMap({ title: 'Deleted later', map: small('g') });
  const backup = await vault.exportBackup();
  await vault.renameMap(keepId, 'Newer local title');
  await vault.deleteMap(goneId);
  const summary = await vault.importBackup(backup, key);
  assert.deepEqual(summary, { added: 1, updated: 0, skipped: 1 });
  const titles = vault.list().map((m) => m.title).sort();
  assert.deepEqual(titles, ['Deleted later', 'Newer local title']);
  assert.equal((await vault.readMap(goneId)).topic, 'g');
  const second = await vault.importBackup(backup, key);
  assert.deepEqual(second, { added: 0, updated: 0, skipped: 2 });
});
