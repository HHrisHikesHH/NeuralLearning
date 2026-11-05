// Mode-based ingestion: Explorer 1 response, Practitioner 2, Researcher 3 — one entry point
// (assembleParts) for all of them. Researcher's own edge cases live in multipart.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadMapFromText, loadMapFromObject, validateSchema, parseNCF, toNCF } from '../js/core/ncf.js';
import { assembleParts, splitBatches, topicSlug, checkEnrichment } from '../js/core/multipart.js';
import { MODES, modeFor } from '../js/core/modes.js';
import { buildPrompt, buildSkeletonPrompt, buildEnrichPrompt } from '../js/core/prompts.js';
import { createFakeGitHub } from './helpers/fake-github.mjs';
import { createGitHub } from '../js/owner/github.js';
import { createVault, initialiseVault } from '../js/owner/vault.js';
import { createShares } from '../js/owner/shares.js';
import { createKeyring } from '../js/owner/crypto.js';

const SAMPLE_TEXT = readFileSync(new URL('../sample.json', import.meta.url), 'utf8');
const SAMPLE = loadMapFromText(SAMPLE_TEXT).data;

/** The complete map for a depth, with every concept explained. */
function fullMap(depth) {
  return loadMapFromObject(toNCF({
    ...SAMPLE, depth,
    nodes: SAMPLE.nodes.map((n, i) => ({ ...n, additionalInfo: `${n.label} (${depth}).\n\nConnections ${i}.`, analogy: i % 4 ? null : `Like ${n.label}` })),
  })).data;
}

/** The responses an AI would give for this depth, as pasted text. */
function responses(depth) {
  const full = fullMap(depth);
  const mode = modeFor(depth);
  if (mode.parts === 1) return { full, texts: [JSON.stringify(toNCF(full))] };
  const skeleton = toNCF({ ...full, nodes: full.nodes.map((n) => ({ ...n, additionalInfo: '', analogy: null })) });
  const skMap = loadMapFromObject(skeleton).data;
  const split = splitBatches(skMap, mode.batches);
  const byId = new Map(full.nodes.map((n) => [n.id, n]));
  const nce = (batch) => ({
    _nce: '1', _id: `${topicSlug(skMap.topic)}_${depth}`, batch, E_cols: ['ni', 'desc', 'info', 'analogy'],
    E: split[`batch${batch}`].map((n) => { const f = byId.get(n.id); return [f.id, f.description, f.additionalInfo, f.analogy]; }),
  });
  const data = Array.from({ length: mode.batches }, (_, i) => JSON.stringify(nce(i + 1), null, 1));
  return { full, skeleton, skMap, split, nce, texts: [JSON.stringify(skeleton, null, 1), ...data] };
}
const errText = (r) => r.errors.join('\n');

// ── The mode table ──

test('response counts follow the depth: explorer 1, practitioner 2, researcher 3', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, m.parts])), { explorer: 1, practitioner: 2, researcher: 3 });
  assert.deepEqual(MODES.practitioner.labels, ['Skeleton', 'Data Part']);
  assert.deepEqual(MODES.researcher.labels, ['Skeleton', 'Data Part 1', 'Data Part 2']);
  assert.equal(MODES.explorer.progressive, false);
  assert.equal(modeFor('unknown'), MODES.explorer);
});

// ── Explorer: one response ──

test('explorer: one valid response assembles into the map', () => {
  const { full, texts } = responses('explorer');
  const r = assembleParts('explorer', texts);
  assert.equal(r.ok, true, errText(r));
  assert.deepEqual(r.map, full);
  assert.equal(r.parts.length, 1);
});

test('explorer: invalid JSON, cut-off output and a missing response are reported', () => {
  const bad = assembleParts('explorer', ['{"topic": nope}']);
  assert.equal(bad.ok, false);
  assert.match(errText(bad), /^Map JSON: Invalid JSON/m);
  const { texts } = responses('explorer');
  assert.match(errText(assembleParts('explorer', [texts[0].slice(0, 500)])), /cut off/);
  for (const missing of [[], [''], ['  ']]) {
    const r = assembleParts('explorer', missing);
    assert.equal(r.ok, false);
    assert.match(errText(r), /^Map JSON is missing/m);
    assert.equal(r.parts[0].missing, true);
  }
  assert.match(errText(assembleParts('explorer', ['{"_ncf":"1","N_cols":[],"L_cols":[],"LP_cols":[]}'])), /Map JSON: Missing: topic/);
});

test('explorer: existing single-part maps (legacy and NCF) stay compatible', () => {
  const legacy = assembleParts('explorer', [SAMPLE_TEXT]);
  assert.equal(legacy.ok, true);
  assert.deepEqual(legacy.map, SAMPLE);
  const ncf = assembleParts('explorer', [JSON.stringify(toNCF(SAMPLE))]);
  assert.deepEqual(ncf.map, SAMPLE);
  // The single loader is unchanged: same result as loadMapFromText.
  assert.deepEqual(assembleParts('explorer', [SAMPLE_TEXT]).map, loadMapFromText(SAMPLE_TEXT).data);
});

// ── Practitioner: two responses ──

test('practitioner: skeleton + data part assemble into the complete map with nothing lost', () => {
  const { full, texts, split } = responses('practitioner');
  assert.equal(texts.length, 2);
  assert.equal(split.batch1.length, 79, 'one data part covers every concept');
  assert.equal(split.batch2.length, 0);
  const r = assembleParts('practitioner', texts);
  assert.equal(r.ok, true, errText(r));
  assert.deepEqual(r.map, full);
  assert.equal(r.enriched, 79);
  assert.equal(validateSchema(parseNCF(toNCF(r.map))).ok, true, 'final map is valid NCF');
  assert.equal(r.parts.length, 2);
});

test('practitioner: a missing skeleton or data part blocks a complete import and names the part', () => {
  const { texts } = responses('practitioner');
  const noSk = assembleParts('practitioner', ['', texts[1]]);
  assert.equal(noSk.ok, false);
  assert.match(errText(noSk), /^Skeleton is missing/m);
  const noData = assembleParts('practitioner', [texts[0], '']);
  assert.equal(noData.ok, false);
  assert.match(errText(noData), /^Data Part is missing/m);
  assert.match(errText(noData), /79 of 79 concept\(s\) have no explanation in the data part/);
});

test('practitioner: progressive (generate) mode renders the skeleton and names what is missing', () => {
  const { texts } = responses('practitioner');
  const r = assembleParts('practitioner', [texts[0]], { requireComplete: false });
  assert.equal(r.ok, true, errText(r));
  assert.equal(r.enriched, 0);
  assert.equal(r.missing.length, 79);
  assert.ok(r.warnings.some((w) => /have no explanation in the data part/.test(w)));
});

test('practitioner: invalid JSON in either part is reported against that part', () => {
  const { texts } = responses('practitioner');
  for (const [i, label] of [[0, 'Skeleton'], [1, 'Data Part']]) {
    const t = [...texts];
    t[i] = '{ not json';
    const r = assembleParts('practitioner', t);
    assert.equal(r.ok, false);
    assert.match(errText(r), new RegExp(`^${label}: invalid JSON`, 'm'));
    assert.equal(r.parts[1 - i].errors.some((e) => /invalid JSON/.test(e)), false, 'the other part is not blamed');
  }
});

test('practitioner: duplicate identifiers are rejected', () => {
  const { texts, skeleton, nce } = responses('practitioner');
  const dupSk = structuredClone(skeleton);
  dupSk.N.push([...dupSk.N[0]]);
  assert.match(errText(assembleParts('practitioner', [JSON.stringify(dupSk), texts[1]])), /Skeleton: duplicate concept ids/);
  const dupData = nce(1);
  dupData.E.push([...dupData.E[0]]);
  assert.match(errText(assembleParts('practitioner', [texts[0], JSON.stringify(dupData)])), /Data Part: concept ids repeated within this batch/);
});

test('practitioner: invalid relationship references are rejected', () => {
  const { texts, skeleton, nce } = responses('practitioner');
  const s = structuredClone(skeleton);
  s.L[0][0] = 'ghost_source';
  s.N[2][7] = ['ghost_prereq'];
  const r = assembleParts('practitioner', [JSON.stringify(s), texts[1]]);
  assert.match(errText(r), /Skeleton: links\[0\]: source "ghost_source" not found/);
  assert.match(errText(r), /prerequisite "ghost_prereq" not found/);
  const extra = nce(1);
  extra.E.push(['invented', 'd', 'info', null]);
  assert.match(errText(assembleParts('practitioner', [texts[0], JSON.stringify(extra)])), /Data Part: 1 concept id\(s\) do not exist in the skeleton: "invented"/);
});

test('practitioner: conflicting metadata — wrong batch, wrong slot, mismatched _id, wrong depth', () => {
  const { texts, nce, skMap } = responses('practitioner');
  const b2 = { ...nce(1), batch: 2 };
  assert.match(errText(assembleParts('practitioner', [texts[0], JSON.stringify(b2)])), /Data Part: this response says "batch": 2 — expected 1\./);
  assert.match(errText(assembleParts('practitioner', [texts[0], texts[0]])), /Data Part: this looks like the skeleton \(NCF\)/);
  assert.match(errText(assembleParts('practitioner', [texts[1], texts[1]])), /Skeleton: this looks like an enrichment response \(NCE\).*paste it into Data Part\./);
  const otherId = assembleParts('practitioner', [texts[0], JSON.stringify({ ...nce(1), _id: 'something_else' })]);
  assert.equal(otherId.ok, true);
  assert.ok(otherId.warnings.some((w) => /"_id" is "something_else"/.test(w)));
  const researcherSkeleton = assembleParts('practitioner', [texts[0].replace('"depth": "practitioner"', '"depth": "researcher"'), texts[1]]);
  assert.ok(researcherSkeleton.warnings.some((w) => /depth is "researcher", not "practitioner"/.test(w)));
  assert.throws(() => checkEnrichment(texts[1], { part: 2, batches: 1, skeleton: skMap }), /part must be 1–1/);
});

test('practitioner: final validation failures block the map', () => {
  const { texts, skeleton } = responses('practitioner');
  const s = structuredClone(skeleton);
  s.categories = s.categories.slice(0, 1);
  const r = assembleParts('practitioner', [JSON.stringify(s), texts[1]]);
  assert.equal(r.ok, false);
  assert.equal(r.map, null);
  assert.match(errText(r), /Skeleton: categories: must be array with 2\+ items/);
  const emptyInfo = responses('practitioner').nce(1);
  emptyInfo.E[5][2] = '';
  const r2 = assembleParts('practitioner', [texts[0], JSON.stringify(emptyInfo)]);
  assert.equal(r2.ok, false);
  assert.match(errText(r2), /info is empty/);
});

test('practitioner: a partial data part is never treated as complete', () => {
  const { texts, nce } = responses('practitioner');
  const partial = nce(1);
  partial.E = partial.E.slice(0, 60);
  const r = assembleParts('practitioner', [texts[0], JSON.stringify(partial)]);
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 19);
  const progressive = assembleParts('practitioner', [texts[0], JSON.stringify(partial)], { requireComplete: false });
  assert.equal(progressive.ok, true);
  assert.equal(progressive.enriched, 60, 'progressive mode says exactly how much is explained');
});

// ── Researcher through the common entry point ──

test('researcher: three responses through assembleParts give the complete map', () => {
  const { full, texts } = responses('researcher');
  assert.equal(texts.length, 3);
  const r = assembleParts('researcher', texts);
  assert.equal(r.ok, true, errText(r));
  assert.deepEqual(r.map, full);
  for (const [i, label] of [[0, 'Skeleton'], [1, 'Data Part 1'], [2, 'Data Part 2']]) {
    const t = [...texts];
    t[i] = '';
    assert.match(errText(assembleParts('researcher', t)), new RegExp(`^${label} is missing`, 'm'));
  }
});

// ── Prompts ──

test('researcher prompts are byte-identical to the historical ones', () => {
  const h = (s) => createHash('sha256').update(s).digest('hex');
  assert.equal(h(buildSkeletonPrompt('Buddhism', 'researcher')), 'e35518d049d4c832edf9bb42b4fb4dcd6e80789d2f96242c5bf5d779d462d2f6');
  assert.equal(h(buildEnrichPrompt('Buddhism', 'researcher', SAMPLE, 1)), '8bb9f15b814033121088790e5e8c7c5639be4af225411c9a512ec220697759ff');
  assert.equal(h(buildEnrichPrompt('Buddhism', 'researcher', SAMPLE, 2)), '1c96122ada460410b71d118387c3b53c8ca2c9c8750cce68e3ecfabe30918a28');
  assert.equal(buildSkeletonPrompt('Buddhism', 'researcher', 3), buildSkeletonPrompt('Buddhism', 'researcher'));
});

test('practitioner prompts: part 1 of 2, then one data part listing every concept', () => {
  const sk = buildSkeletonPrompt('Buddhism', 'practitioner', 2);
  assert.ok(sk.includes('SKELETON ONLY (Part 1 of 2)'));
  assert.ok(sk.includes('This is a 2-part generation.'));
  assert.ok(sk.includes('content comes in Part 2\n'));
  assert.ok(!sk.includes('Parts 2 & 3'));
  const data = buildEnrichPrompt('Buddhism', 'practitioner', SAMPLE, 1, 1);
  assert.ok(data.includes('(Part 2 of 2 · Batch 1 of 1)'));
  assert.ok(data.includes('BATCH:  1 of 1 — enriching 79 of 79 nodes'));
  assert.ok(!data.includes('OTHER batch'));
  assert.ok(data.includes('"_id": "buddhism_practitioner"'));
  assert.ok(data.includes('HOW TO WRITE info (4-6 paragraphs)'));
  assert.equal([...data.matchAll(/^ {2}NODE: /gm)].length, 79);
  assert.ok(buildPrompt('Buddhism', 'explorer').includes('DEPTH:     explorer'), 'explorer keeps the single prompt');
});

// ── Save and share maps from every mode ──

test('maps built in each mode save to the encrypted vault and can be shared', async () => {
  const fake = createFakeGitHub();
  fake.repo('NeuronVault');
  fake.repo('NeuronShares');
  const gh = createGitHub(fake.token, { fetchImpl: fake.fetchImpl, retryDelays: [1] });
  const { keyring, key } = await createKeyring('correct horse battery staple', 100_000);
  await initialiseVault(gh, keyring, key);
  const vault = createVault(gh, key);
  await vault.refresh();
  const image = async () => ({ base64: Buffer.from('PNG').toString('base64'), ext: 'png', mime: 'image/png' });
  const shares = createShares(gh, vault, { renderImage: image });

  for (const depth of ['explorer', 'practitioner', 'researcher']) {
    const { map } = assembleParts(depth, responses(depth).texts);
    const id = await vault.saveMap({ title: `${depth} map`, map });
    assert.match(fake.readDirect('NeuronVault', `maps/${id}.enc`), /"neuron":"enc"/);
    assert.deepEqual(await vault.readMap(id), map, `${depth}: vault round trip`);
    const pub = await shares.publish(vault.entry(id), map);
    const snap = JSON.parse(fake.readDirect('NeuronShares', `s/${pub.id}/map.json`));
    assert.deepEqual(loadMapFromObject(snap.map).data, map, `${depth}: shared snapshot opens`);
  }
  assert.equal(vault.list().length, 3);
});
