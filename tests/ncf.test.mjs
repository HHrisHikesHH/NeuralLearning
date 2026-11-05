import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMapFromText, loadMapFromObject, parseNCF, parseNCE, mergeEnrichment, sanitizeMap, toNCF, safeColor, stripFences } from '../js/core/ncf.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const NCF_EXAMPLE = {
  _ncf: '1', topic: 'Distributed Systems', depth: 'explorer', summary: 'S',
  categories: [
    { id: 'foundations', label: 'Foundations', color: '#4fc3f7', icon: '🌱', description: '…' },
    { id: 'practice', label: 'Practice', color: '#69f0ae', icon: '🛠', description: '…' },
  ],
  N_cols: ['id', 'label', 'cat', 'hot', 'dl', 'desc', 'info', 'prereq', 'analogy'],
  N: [
    ['cap_theorem', 'CAP Theorem', 'foundations', 1, 1, 'd', 'CAP info', [], 'phone plan'],
    ['sharding', 'Sharding', 'foundations', 0, 2, 'd', 'info', ['cap_theorem'], null],
    ['replication', 'Replication', 'practice', 0, 2, 'd', 'info', [], null],
    ['consensus', 'Consensus', 'practice', 1, 3, 'd', 'info', ['replication'], null],
    ['quorum', 'Quorum', 'practice', 0, 2, 'd', 'info', [], null],
  ],
  L_cols: ['src', 'tgt', 'rel', 'tp', 'w', 'lbl'],
  L: [
    ['cap_theorem', 'sharding', 'feeds_into', 'hierarchical', 3, 'x'],
    ['replication', 'consensus', 'enables', 'semantic', 2, ''],
    ['consensus', 'quorum', 'is_analog_of', 'cross_domain', 1, ''],
  ],
  LP_cols: ['ni', 'o', 'ph', 'rs', 'em', 'ki'],
  LP: [['cap_theorem', 1, 'Foundations', 'why', 25, 'k'], ['sharding', 2, 'Core', 'why', 20, 'k']],
  meta: { tc: 5, tl: 3, central: 'cap_theorem', insights: ['i'], next: ['n'], misconceptions: ['m'] },
};

test('legacy sample.json loads with every node, link and step intact', () => {
  const raw = JSON.parse(read('../sample.json'));
  const r = loadMapFromText(read('../sample.json'));
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.data.nodes.length, raw.nodes.length);
  assert.equal(r.data.links.length, raw.links.length);
  assert.equal(r.data.learningPath.length, raw.learningPath.length);
  assert.equal(r.data.categories.length, raw.categories.length);
  assert.equal(r.data.topic, 'buddhism');
  assert.equal(r.data.nodes[0].label, raw.nodes[0].label);
  assert.deepEqual(r.data.metadata.suggestedNextTopics, raw.metadata.suggestedNextTopics);
});

test('NCF expands to the same model the original parser produced', () => {
  const r = loadMapFromObject(NCF_EXAMPLE);
  assert.equal(r.ok, true, r.errors.join('\n'));
  const cap = r.data.nodes[0];
  assert.deepEqual(cap, {
    id: 'cap_theorem', label: 'CAP Theorem', category: 'foundations', hot: true, depth_level: 1,
    description: 'd', additionalInfo: 'CAP info', prerequisites: [], analogy: 'phone plan',
  });
  assert.equal(r.data.metadata.centralNode, 'cap_theorem');
  assert.deepEqual(r.data.links[0], { source: 'cap_theorem', target: 'sharding', relation: 'feeds_into', type: 'hierarchical', weight: 3, label: 'x' });
});

test('markdown fences are stripped', () => {
  const r = loadMapFromText('```json\n' + JSON.stringify(NCF_EXAMPLE) + '\n```');
  assert.equal(r.ok, true);
  assert.equal(stripFences('```\n{}\n```'), '{}');
});

test('original schema errors are still reported with the same wording', () => {
  const bad = structuredClone(NCF_EXAMPLE);
  bad.L.push(['cap_theorem', 'ghost', 'enables', 'semantic', 1, '']);
  bad.N[1][7] = ['missing_prereq'];
  const r = loadMapFromObject(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('links[3]: target "ghost" not found'));
  assert.ok(r.errors.includes('nodes[1] "sharding": prerequisite "missing_prereq" not found'));
  assert.deepEqual(loadMapFromObject({ topic: 'x' }).errors.slice(0, 2), ['Missing: depth', 'Missing: summary']);
});

test('malformed input never throws', () => {
  for (const input of ['', 'not json', '[]', 'null', '42', '{"_ncf":"1"}', '{"_ncf":"1","N_cols":[],"L_cols":[],"LP_cols":[],"N":{}}']) {
    const r = loadMapFromText(input);
    assert.equal(r.ok, false, input);
    assert.ok(r.errors.length > 0);
  }
  const wrongTypes = structuredClone(NCF_EXAMPLE);
  wrongTypes.N[0][1] = 12345;
  wrongTypes.N[1][7] = 'cap_theorem';
  const r = loadMapFromObject(wrongTypes);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('label must be a string')));
  assert.ok(r.errors.some((e) => e.includes('prerequisites must be an array')));
});

test('size limits are enforced', () => {
  const big = structuredClone(NCF_EXAMPLE);
  big.N = Array.from({ length: 700 }, (_, i) => [`n${i}`, `N${i}`, 'foundations', 0, 1, '', '', [], null]);
  assert.equal(loadMapFromObject(big).ok, false);
  assert.equal(loadMapFromText(' '.repeat(9_000_000) + '{}').kind, 'size');
});

test('malicious map is neutralised: safe colours, deduped ids, bounded numbers', () => {
  const r = loadMapFromText(read('./fixtures/malicious.json'));
  assert.equal(r.ok, true, r.errors.join('\n'));
  const d = r.data;
  for (const c of d.categories) assert.match(c.color, /^#[0-9a-f]{6}$/);
  assert.equal(d.categories[1].color, '#aabbcc');
  assert.equal(d.nodes.length, 5, 'duplicate node id dropped');
  assert.equal(d.nodes[1].depth_level, 3, 'depth level clamped');
  assert.equal(d.nodes[2].hot, false, 'string "1" is not treated as hot');
  assert.equal(d.links[0].type, 'semantic');
  assert.equal(d.links[0].weight, 3);
  assert.ok(!d.links.some((l) => l.source === l.target), 'self loops removed');
  assert.equal(d.learningPath.length, 3, 'repeated concepts in the path are kept');
  assert.equal(d.learningPath[2].estimatedMinutes, 0);
  assert.equal(d.metadata.centralNode, null);
  assert.deepEqual(d.metadata.crossDomainInsights, ['<b>x</b>'], 'non-strings dropped; markup kept as inert text');
  assert.ok(!d.summary.includes('‮'), 'bidi override stripped');
});

test('safeColor rejects everything except hex', () => {
  assert.equal(safeColor('#0F0'), '#00ff00');
  assert.equal(safeColor(' #4fc3f7 '), '#4fc3f7');
  for (const v of ['red', 'url(x)', '#12345', '#1234567', 'expression(alert(1))', null, 5]) assert.match(safeColor(v), /^#[0-9a-f]{6}$/);
});

test('NCE enrichment merges into a skeleton', () => {
  const skel = parseNCF(NCF_EXAMPLE);
  const nce = parseNCE(JSON.stringify({ _nce: '1', E_cols: ['ni', 'desc', 'info', 'analogy'], E: [['sharding', 'new desc', 'new info', 'like pizza'], ['bogus']] }));
  const merged = sanitizeMap(mergeEnrichment(skel, nce));
  const s = merged.nodes.find((n) => n.id === 'sharding');
  assert.equal(s.additionalInfo, 'new info');
  assert.equal(s.analogy, 'like pizza');
  assert.throws(() => parseNCE('{"x":1}'), /missing _nce/);
});

test('toNCF round-trips through the loader', () => {
  const a = loadMapFromObject(NCF_EXAMPLE).data;
  const b = loadMapFromObject(JSON.parse(JSON.stringify(toNCF(a)))).data;
  assert.deepEqual(b, a);
  const legacy = loadMapFromText(read('../sample.json')).data;
  assert.deepEqual(loadMapFromObject(toNCF(legacy)).data, legacy);
});
