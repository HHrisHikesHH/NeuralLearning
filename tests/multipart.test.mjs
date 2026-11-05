import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMapFromText, loadMapFromObject, validateSchema, parseNCF, toNCF } from '../js/core/ncf.js';
import { checkSkeleton, checkEnrichment, assembleResearcherMap, splitBatches, topicSlug } from '../js/core/multipart.js';
import { buildEnrichPrompt } from '../js/core/prompts.js';
import { createFakeGitHub } from './helpers/fake-github.mjs';
import { createGitHub } from '../js/owner/github.js';
import { createVault, initialiseVault } from '../js/owner/vault.js';
import { createShares } from '../js/owner/shares.js';
import { createKeyring } from '../js/owner/crypto.js';

// ── Fixtures: a real 79-concept researcher map split the way the three prompts split it ──

const SAMPLE = loadMapFromText(readFileSync(new URL('../sample.json', import.meta.url), 'utf8')).data;
// The complete map we expect back: every concept has a full explanation, some have analogies.
const FULL = loadMapFromObject(toNCF({
  ...SAMPLE,
  nodes: SAMPLE.nodes.map((n, i) => ({
    ...n,
    additionalInfo: `${n.label} in depth.\n\nHow it connects to the rest of the map (${i}).`,
    analogy: i % 3 === 0 ? `Like ${n.label.toLowerCase()} in everyday life.` : null,
  })),
})).data;

const SKELETON_NCF = toNCF({ ...FULL, nodes: FULL.nodes.map((n) => ({ ...n, additionalInfo: '', analogy: null })) });
const SKELETON_MAP = loadMapFromObject(SKELETON_NCF).data;
const SPLIT = splitBatches(SKELETON_MAP);
const byId = new Map(FULL.nodes.map((n) => [n.id, n]));
const nce = (batch, nodes = SPLIT[`batch${batch}`], extra = {}) => ({
  _nce: '1', _id: `${topicSlug(SKELETON_MAP.topic)}_${SKELETON_MAP.depth}`, batch,
  E_cols: ['ni', 'desc', 'info', 'analogy'],
  E: nodes.map((n) => { const f = byId.get(n.id); return [f.id, f.description, f.additionalInfo, f.analogy]; }),
  ...extra,
});
const J = (o) => JSON.stringify(o, null, 2);
const TEXTS = { skeleton: J(SKELETON_NCF), part1: J(nce(1)), part2: J(nce(2)) };
const errText = (r) => r.errors.join('\n');

// ── 1 + 10: the happy path, and the result is a valid single complete NCF map ──

test('valid skeleton + Data Part 1 + Data Part 2 assemble into the complete map with nothing lost', () => {
  assert.ok(SPLIT.batch1.length && SPLIT.batch2.length && SPLIT.batch1.length + SPLIT.batch2.length === 79);
  const r = assembleResearcherMap(TEXTS);
  assert.equal(r.ok, true, errText(r));
  assert.deepEqual(r.map, FULL, 'concepts, links, learning path, metadata, explanations and analogies are all preserved');
  assert.equal(r.enriched, 79);
  assert.equal(r.total, 79);
  assert.deepEqual(r.missing, []);
  assert.equal(r.map.links.length, SAMPLE.links.length);
  assert.equal(r.map.learningPath.length, SAMPLE.learningPath.length);
  assert.deepEqual(r.map.metadata, FULL.metadata);
});

test('the assembled map passes full NCF validation and round-trips like a single-part map', () => {
  const r = assembleResearcherMap(TEXTS);
  assert.equal(validateSchema(parseNCF(toNCF(r.map))).ok, true);
  const again = loadMapFromText(JSON.stringify(toNCF(r.map)));
  assert.equal(again.ok, true);
  assert.deepEqual(again.data, r.map);
});

test('fenced responses are accepted in every slot', () => {
  const fence = (t) => '```json\n' + t + '\n```';
  const r = assembleResearcherMap({ skeleton: fence(TEXTS.skeleton), part1: fence(TEXTS.part1), part2: fence(TEXTS.part2) });
  assert.equal(r.ok, true, errText(r));
});

// ── 2–4: missing parts ──

test('missing skeleton is reported and nothing is assembled', () => {
  for (const skeleton of ['', '   ', undefined]) {
    const r = assembleResearcherMap({ ...TEXTS, skeleton });
    assert.equal(r.ok, false);
    assert.equal(r.map, null);
    assert.match(errText(r), /^Skeleton is missing/m);
    assert.equal(r.parts.skeleton.missing, true);
  }
});

test('missing Data Part 1 / Data Part 2 block a complete import and name the part', () => {
  for (const [key, label, otherKey] of [['part1', 'Data Part 1', 'part2'], ['part2', 'Data Part 2', 'part1']]) {
    const r = assembleResearcherMap({ ...TEXTS, [key]: '' });
    assert.equal(r.ok, false);
    assert.match(errText(r), new RegExp(`^${label} is missing`, 'm'));
    const otherCount = SPLIT[otherKey === 'part1' ? 'batch1' : 'batch2'].length;
    assert.match(errText(r), new RegExp(`${79 - otherCount} of 79 concept\\(s\\) have no explanation`));
  }
});

test('progressive (generate) mode: skeleton alone renders, with the un-enriched concepts named', () => {
  const r = assembleResearcherMap({ skeleton: TEXTS.skeleton }, { requireComplete: false });
  assert.equal(r.ok, true, errText(r));
  assert.equal(r.enriched, 0);
  assert.equal(r.missing.length, 79);
  assert.ok(r.warnings.some((w) => /79 of 79 concept\(s\) have no explanation/.test(w)));
  const half = assembleResearcherMap({ skeleton: TEXTS.skeleton, part1: TEXTS.part1 }, { requireComplete: false });
  assert.equal(half.ok, true);
  assert.equal(half.enriched, SPLIT.batch1.length);
  assert.deepEqual([...half.missing].sort(), SPLIT.batch2.map((n) => n.id).sort());
  // A part that is present but broken still blocks, even in progressive mode.
  const bad = assembleResearcherMap({ skeleton: TEXTS.skeleton, part1: '{oops' }, { requireComplete: false });
  assert.equal(bad.ok, false);
  assert.match(errText(bad), /^Data Part 1: invalid JSON/m);
});

// ── 5–6: invalid JSON and incomplete output ──

test('invalid JSON is reported against the exact part that failed', () => {
  for (const [key, label] of [['skeleton', 'Skeleton'], ['part1', 'Data Part 1'], ['part2', 'Data Part 2']]) {
    const r = assembleResearcherMap({ ...TEXTS, [key]: '{"_ncf": "1", "topic": oops}' });
    assert.equal(r.ok, false);
    assert.match(errText(r), new RegExp(`^${label}: invalid JSON`, 'm'));
    for (const other of ['Skeleton', 'Data Part 1', 'Data Part 2'].filter((l) => l !== label)) {
      assert.equal(r.parts[{ Skeleton: 'skeleton', 'Data Part 1': 'part1', 'Data Part 2': 'part2' }[other]].errors.some((e) => /invalid JSON/.test(e)), false);
    }
  }
  assert.match(errText(checkSkeleton('[1,2]')), /top level must be a JSON object/);
});

test('truncated AI output gets a "cut off" hint', () => {
  for (const [key, label] of [['skeleton', 'Skeleton'], ['part1', 'Data Part 1'], ['part2', 'Data Part 2']]) {
    const t = TEXTS[key];
    const r = assembleResearcherMap({ ...TEXTS, [key]: t.slice(0, Math.floor(t.length * 0.6)) });
    assert.match(errText(r), new RegExp(`^${label}: invalid JSON.*cut off`, 'm'));
  }
});

test('an incomplete batch (valid JSON, rows missing) lists the concepts without explanations', () => {
  const short = nce(2, SPLIT.batch2.slice(0, 5));
  const r = assembleResearcherMap({ ...TEXTS, part2: J(short) });
  assert.equal(r.ok, false);
  assert.deepEqual([...r.missing].sort(), SPLIT.batch2.slice(5).map((n) => n.id).sort());
  assert.match(errText(r), new RegExp(`${SPLIT.batch2.length - 5} of 79 concept`));
});

test('an empty E array, empty info and broken rows are errors, not silently skipped', () => {
  assert.match(errText(checkEnrichment(J(nce(1, [])), { part: 1 })), /"E" has no rows/);
  const rows = nce(1);
  rows.E[0][2] = '';
  rows.E[1] = 'not a row';
  rows.E[2] = [null, 'd', 'i', null];
  const r = checkEnrichment(J(rows), { part: 1, skeleton: SKELETON_MAP });
  assert.equal(r.ok, false);
  assert.match(errText(r), /row 1 ".+": info is empty/);
  assert.match(errText(r), /row 2 must be an array/);
  assert.match(errText(r), /row 3 has no concept id/);
  const noCols = { ...nce(1), E_cols: ['ni', 'desc'] };
  assert.match(errText(checkEnrichment(J(noCols), { part: 1 })), /"E_cols" must include "info"/);
});

// ── 7: duplicate identifiers ──

test('duplicate concept ids in the skeleton are rejected, not silently de-duplicated', () => {
  const dup = structuredClone(SKELETON_NCF);
  dup.N.push([...dup.N[3]]);
  const r = checkSkeleton(J(dup));
  assert.equal(r.ok, false);
  assert.match(errText(r), new RegExp(`Skeleton: duplicate concept ids "${dup.N[3][0]}"`));
  const dupCat = structuredClone(SKELETON_NCF);
  dupCat.categories.push({ ...dupCat.categories[0] });
  assert.match(errText(checkSkeleton(J(dupCat))), /duplicate category ids/);
});

test('duplicate concept ids within one batch are rejected', () => {
  const b = nce(1);
  b.E.push([...b.E[0]]);
  const r = checkEnrichment(J(b), { part: 1, skeleton: SKELETON_MAP });
  assert.equal(r.ok, false);
  assert.match(errText(r), /repeated within this batch/);
});

test('a concept in both batches: identical content is allowed, different content is a conflict', () => {
  const id = SPLIT.batch1[0].id;
  const same = nce(2, [...SPLIT.batch2, SPLIT.batch1[0]]);
  const ok = assembleResearcherMap({ ...TEXTS, part2: J(same) });
  assert.equal(ok.ok, true, errText(ok));
  assert.ok(ok.warnings.some((w) => /appear identically in both/.test(w)));
  const diff = structuredClone(same);
  diff.E[diff.E.length - 1][2] = 'A different explanation';
  const bad = assembleResearcherMap({ ...TEXTS, part2: J(diff) });
  assert.equal(bad.ok, false);
  assert.match(errText(bad), new RegExp(`Conflict: 1 concept\\(s\\) appear in both Data Part 1 and Data Part 2 with different content: "${id}"`));
});

test('repeated links are reported as warnings', () => {
  const s = structuredClone(SKELETON_NCF);
  s.L.push([...s.L[0]]);
  const r = checkSkeleton(J(s));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /repeated links/.test(w)));
});

// ── 8: references to nonexistent concepts ──

test('skeleton links, prerequisites and learning-path steps must reference existing concepts', () => {
  const s = structuredClone(SKELETON_NCF);
  s.L[0][1] = 'no_such_concept';
  s.N[1][7] = ['ghost_prereq'];
  s.LP[0][0] = 'ghost_step';
  const r = checkSkeleton(J(s));
  assert.equal(r.ok, false);
  assert.match(errText(r), /Skeleton: links\[0\]: target "no_such_concept" not found/);
  assert.match(errText(r), /prerequisite "ghost_prereq" not found/);
  assert.match(errText(r), /learningPath\[0\]: nodeId "ghost_step" not found/);
  const badCat = structuredClone(SKELETON_NCF);
  badCat.N[0][2] = 'nope';
  assert.match(errText(checkSkeleton(J(badCat))), /category "nope" not found/);
});

test('enrichment rows for concepts that are not in the skeleton are errors', () => {
  const b = nce(1);
  b.E.push(['invented_concept', 'd', 'info', null]);
  const r = assembleResearcherMap({ ...TEXTS, part1: J(b) });
  assert.equal(r.ok, false);
  assert.match(errText(r), /Data Part 1: 1 concept id\(s\) do not exist in the skeleton: "invented_concept"/);
});

// ── 9: conflicting metadata, wrong slot, unexpected fields ──

test('batch numbers are enforced: swapped parts are caught and the right slot is named', () => {
  const r = assembleResearcherMap({ ...TEXTS, part1: TEXTS.part2, part2: TEXTS.part1 });
  assert.equal(r.ok, false);
  assert.match(errText(r), /Data Part 1: this response says "batch": 2 — paste it into Data Part 2/);
  assert.match(errText(r), /Data Part 2: this response says "batch": 1 — paste it into Data Part 1/);
  assert.match(errText(checkEnrichment(J(nce(1, undefined, { batch: 7 })), { part: 1 })), /expected 1 or 2/);
});

test('an NCE in the skeleton slot, or the skeleton in a data slot, is explained', () => {
  assert.match(errText(checkSkeleton(TEXTS.part2)), /Skeleton: this looks like an enrichment response \(NCE\).*Data Part 2/);
  assert.match(errText(checkEnrichment(TEXTS.skeleton, { part: 1 })), /Data Part 1: this looks like the skeleton \(NCF\)/);
  assert.match(errText(checkEnrichment('{"E":[]}', { part: 2 })), /"_nce" field is missing/);
});

test('mismatched _id, a missing batch field and off-split rows are warnings, not errors', () => {
  const b = nce(1, undefined, { _id: 'other_topic_researcher' });
  delete b.batch;
  const r = checkEnrichment(J(b), { part: 1, skeleton: SKELETON_MAP });
  assert.equal(r.ok, true, errText(r));
  assert.ok(r.warnings.some((w) => /"_id" is "other_topic_researcher"/.test(w)));
  assert.ok(r.warnings.some((w) => /no "batch" field/.test(w)));
  // Generate mode checks against the topic the owner typed.
  const g = checkEnrichment(J(nce(1)), { part: 1, skeleton: SKELETON_MAP, expectedId: 'typed_topic_researcher' });
  assert.ok(g.warnings.some((w) => /expected "typed_topic_researcher"/.test(w)));
  // A row that belongs to batch 2 under the standard split is still used.
  const moved = assembleResearcherMap({ ...TEXTS, part1: J(nce(1, [...SPLIT.batch1, SPLIT.batch2[0]])), part2: J(nce(2, SPLIT.batch2.slice(1))) });
  assert.equal(moved.ok, true, errText(moved));
  assert.ok(moved.warnings.some((w) => /belong to the other batch/.test(w)));
  assert.deepEqual(moved.map, FULL);
});

test('unexpected extra fields and columns are tolerated with a warning', () => {
  const s = { ...SKELETON_NCF, model_notes: 'hi' };
  const sr = checkSkeleton(J(s));
  assert.equal(sr.ok, true);
  assert.ok(sr.warnings.some((w) => /unexpected fields "model_notes"/.test(w)));
  const b = nce(1);
  b.E_cols = ['ni', 'desc', 'info', 'analogy', 'confidence'];
  b.E = b.E.map((row) => [...row, 0.9]);
  b.comment = 'x';
  const br = checkEnrichment(J(b), { part: 1, skeleton: SKELETON_MAP });
  assert.equal(br.ok, true, errText(br));
  assert.ok(br.warnings.some((w) => /unexpected columns "confidence"/.test(w)));
  assert.ok(br.warnings.some((w) => /unexpected fields "comment"/.test(w)));
  // Reordered columns are honoured.
  const re = nce(2);
  re.E_cols = ['info', 'ni', 'analogy', 'desc'];
  re.E = re.E.map(([ni, desc, info, analogy]) => [info, ni, analogy, desc]);
  assert.deepEqual(assembleResearcherMap({ ...TEXTS, part2: J(re) }).map, FULL);
});

test('missing required skeleton fields are reported', () => {
  const s = structuredClone(SKELETON_NCF);
  delete s.summary;
  s.N = s.N.slice(0, 2);
  const r = checkSkeleton(J(s));
  assert.match(errText(r), /Skeleton: Missing: summary/);
  assert.match(errText(r), /Skeleton: nodes: must be array with 5\+ items/);
  const noCols = structuredClone(SKELETON_NCF);
  delete noCols.L_cols;
  assert.match(errText(checkSkeleton(J(noCols))), /Skeleton: NCF: "L_cols" must be an array/);
});

// ── 11: the existing single-part flow and the historical prompt split are unchanged ──

test('single-part map ingestion still works', () => {
  const r = loadMapFromText(JSON.stringify(toNCF(FULL)));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, FULL);
  assert.equal(loadMapFromText(readFileSync(new URL('../sample.json', import.meta.url), 'utf8')).ok, true);
});

test('enrichment prompts still list exactly the historical batch split', () => {
  // Historical algorithm (6472f35 buildEnrichPrompt), reimplemented independently.
  const lp = new Map(SKELETON_MAP.learningPath.map((s) => [s.nodeId, s.order]));
  const sorted = [...SKELETON_MAP.nodes].sort((a, b) => (lp.get(a.id) ?? 999) - (lp.get(b.id) ?? 999));
  const mid = Math.ceil(sorted.length / 2);
  assert.deepEqual(SPLIT.batch1.map((n) => n.id), sorted.slice(0, mid).map((n) => n.id));
  assert.deepEqual(SPLIT.batch2.map((n) => n.id), sorted.slice(mid).map((n) => n.id));
  for (const b of [1, 2]) {
    const p = buildEnrichPrompt('Buddhism', 'researcher', SKELETON_MAP, b);
    const listed = [...p.matchAll(/^ {2}NODE: (\S+) \|/gm)].map((m) => m[1]);
    assert.deepEqual(listed, SPLIT[`batch${b}`].map((n) => n.id));
    assert.ok(p.includes(`"_id": "buddhism_researcher"`));
    assert.ok(p.includes(`"batch": ${b},`));
  }
});

// ── 12–13: researcher maps go through the vault and sharing like any other map ──

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
  return { fake, vault, shares: createShares(gh, vault, { renderImage: image }) };
}

test('an assembled researcher map saves to the encrypted vault and reads back identically', async () => {
  const { fake, vault } = await setup();
  const { map } = assembleResearcherMap(TEXTS);
  const id = await vault.saveMap({ title: 'Buddhism (researcher)', map });
  const raw = fake.readDirect('NeuronVault', `maps/${id}.enc`);
  assert.match(raw, /"neuron":"enc"/);
  assert.equal(raw.includes(map.nodes[0].additionalInfo), false, 'stored encrypted');
  assert.deepEqual(await vault.readMap(id), map);
});

test('an assembled researcher map can be explicitly shared and the snapshot opens', async () => {
  const { fake, vault, shares } = await setup();
  const { map } = assembleResearcherMap(TEXTS);
  const id = await vault.saveMap({ title: 'Shared researcher map', map });
  const r = await shares.publish(vault.entry(id), map);
  const snap = JSON.parse(fake.readDirect('NeuronShares', `s/${r.id}/map.json`));
  const opened = loadMapFromObject(snap.map);
  assert.equal(opened.ok, true);
  assert.deepEqual(opened.data, map);
});
