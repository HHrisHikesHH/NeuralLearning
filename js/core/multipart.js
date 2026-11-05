// Multi-part maps: a Skeleton (NCF, info left empty) plus NCE data parts — one for Practitioner,
// two (Data Part 1 and Data Part 2) for Researcher; see modes.js. This module validates each part
// on its own, cross-checks the parts against each other, and assembles them into one map that has
// been through the same validation and sanitising pipeline as any single complete NCF map.
// assembleParts() is the single entry point for all depths: Explorer's one response goes through
// the existing single-map loader unchanged.
//
// The formats and the merge semantics are the historical ones (see buildSkeletonPrompt,
// buildEnrichPrompt, parseNCE and mergeEnrichment). This layer adds the strictness: nothing is
// silently dropped, overwritten or de-duplicated, and every message names the part it is about.

import { LIMITS, stripFences, parseNCF, validateSchema, sanitizeMap, mergeEnrichment, toNCF, loadMapFromObject, loadMapFromText } from './ncf.js';
import { MODES, modeFor } from './modes.js';

export const PART_LABELS = Object.freeze({ 0: 'Skeleton', 1: 'Data Part 1', 2: 'Data Part 2' });
const labelsFor = (batches) => (batches === 1 ? MODES.practitioner.labels : MODES.researcher.labels);

const NCF_KEYS = new Set(['_ncf', 'topic', 'depth', 'summary', 'categories', 'N_cols', 'N', 'L_cols', 'L', 'LP_cols', 'LP', 'meta']);
const LEGACY_KEYS = new Set(['topic', 'depth', 'summary', 'categories', 'nodes', 'links', 'learningPath', 'metadata']);
const NCE_KEYS = new Set(['_nce', '_id', 'batch', 'E_cols', 'E']);
const NCE_COLS = ['ni', 'desc', 'info', 'analogy'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIdLike = (v) => (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v));
const listIds = (ids, max = 12) => ids.slice(0, max).map((i) => `"${i}"`).join(', ') + (ids.length > max ? ` … and ${ids.length - max} more` : '');

/** Same slug the enrichment prompt writes into "_id". */
export function topicSlug(topic) {
  return String(topic || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 25);
}

/**
 * The historical batch split: skeleton nodes sorted by learning-path order (nodes that are not
 * on the path go last, in their original order), then cut at ceil(n / 2). With count = 1
 * (Practitioner) every node is in batch1.
 */
export function splitBatches(skeleton, count = 2) {
  const lpOrder = new Map(skeleton.learningPath.map((s) => [s.nodeId, s.order]));
  const sorted = [...skeleton.nodes].sort((a, b) => (lpOrder.get(a.id) ?? 999) - (lpOrder.get(b.id) ?? 999));
  const mid = count === 1 ? sorted.length : Math.ceil(sorted.length / 2);
  return { sorted, batch1: sorted.slice(0, mid), batch2: sorted.slice(mid) };
}

/** Parse one pasted part. Recognises empty input, oversize input and truncated AI output. */
function parsePart(text, label) {
  const raw = typeof text === 'string' ? text : '';
  if (!raw.trim()) return { missing: true, errors: [`${label} is missing — paste the ${label} JSON response.`] };
  if (raw.length > LIMITS.textBytes) return { errors: [`${label}: the response is too large (over ${LIMITS.textBytes / 1_000_000} MB).`] };
  const body = stripFences(raw);
  try {
    const value = JSON.parse(body);
    if (!isObj(value)) return { errors: [`${label}: the top level must be a JSON object { … }.`] };
    return { value, errors: [] };
  } catch (e) {
    const cut = !/[}\]]\s*$/.test(body);
    return {
      errors: [`${label}: invalid JSON (${e.message}).` + (cut
        ? ' The response looks cut off before the end — ask the AI to continue from where it stopped, or regenerate this part.'
        : '')],
    };
  }
}

function duplicates(values) {
  const seen = new Set();
  const dup = new Set();
  for (const v of values) { if (seen.has(v)) dup.add(v); else seen.add(v); }
  return [...dup];
}

/**
 * Validate the Skeleton (Part 1 of 3). Returns the sanitised map when valid.
 * @returns {{ ok: boolean, missing?: boolean, map: object|null, errors: string[], warnings: string[] }}
 */
export function checkSkeleton(text, { batches = 2, depth = 'researcher' } = {}) {
  const L = PART_LABELS[0];
  const labels = labelsFor(batches);
  const p = parsePart(text, L);
  if (!p.value) return { ok: false, missing: !!p.missing, map: null, errors: p.errors, warnings: [] };
  const v = p.value;
  const errors = [];
  const warnings = [];

  if (v._nce != null || Array.isArray(v.E)) {
    const n = Number(v.batch);
    return { ok: false, map: null, warnings, errors: [`${L}: this looks like an enrichment response (NCE), not the skeleton — paste it into ${n >= 1 && n <= batches ? labels[n] : batches === 1 ? labels[1] : 'Data Part 1 or 2'}.`] };
  }

  const known = v._ncf ? NCF_KEYS : LEGACY_KEYS;
  const extra = Object.keys(v).filter((k) => !known.has(k));
  if (extra.length) warnings.push(`${L}: ignoring unexpected fields ${listIds(extra)}.`);

  let expanded;
  try { expanded = parseNCF(v); } catch (e) { return { ok: false, map: null, warnings, errors: [`${L}: ${e.message}`] }; }

  const nodeIds = Array.isArray(expanded.nodes) ? expanded.nodes.filter(isObj).map((n) => n.id).filter(isIdLike).map(String) : [];
  const dupNodes = duplicates(nodeIds);
  if (dupNodes.length) errors.push(`${L}: duplicate concept ids ${listIds(dupNodes)} — every concept id must be unique.`);
  const catIds = Array.isArray(expanded.categories) ? expanded.categories.filter(isObj).map((c) => c.id).filter(isIdLike).map(String) : [];
  const dupCats = duplicates(catIds);
  if (dupCats.length) errors.push(`${L}: duplicate category ids ${listIds(dupCats)}.`);

  const schema = validateSchema(expanded);
  if (!schema.ok) errors.push(...schema.errors.map((e) => `${L}: ${e}`));
  if (errors.length) return { ok: false, map: null, errors, warnings };

  const linkKeys = expanded.links.map((l) => `${l.source} → ${l.target} (${l.relation})`);
  const dupLinks = duplicates(linkKeys);
  if (dupLinks.length) warnings.push(`${L}: repeated links ${listIds(dupLinks, 5)}.`);
  const selfLinks = expanded.links.filter((l) => String(l.source) === String(l.target)).length;
  if (selfLinks) warnings.push(`${L}: ${selfLinks} link(s) connect a concept to itself and will not be drawn.`);
  const dupSteps = duplicates(expanded.learningPath.map((s) => String(s.nodeId)));
  if (dupSteps.length) warnings.push(`${L}: concepts repeated in the learning path ${listIds(dupSteps)}.`);
  if (String(expanded.depth).toLowerCase() !== depth) warnings.push(`${L}: depth is "${expanded.depth}", not "${depth}".`);

  return { ok: true, map: sanitizeMap(expanded), errors, warnings };
}

/**
 * Validate one enrichment batch (Data Part 1 or 2).
 * Pass the validated skeleton map to cross-check concept ids and the batch split.
 * @returns {{ ok: boolean, missing?: boolean, nce: object|null, ids: string[], errors: string[], warnings: string[] }}
 */
export function checkEnrichment(text, { part, batches = 2, skeleton = null, expectedId = null } = {}) {
  const labels = labelsFor(batches);
  const L = labels[part];
  if (!L || part < 1 || part > batches) throw new Error(`checkEnrichment: part must be 1–${batches}`);
  const p = parsePart(text, L);
  const fail = (errors, warnings = []) => ({ ok: false, missing: !!p.missing, nce: null, ids: [], errors, warnings });
  if (!p.value) return fail(p.errors);
  const v = p.value;
  const errors = [];
  const warnings = [];

  if (v._ncf != null || Array.isArray(v.N)) return fail([`${L}: this looks like the skeleton (NCF), not an enrichment batch — paste it into Skeleton.`]);
  if (!v._nce) return fail([`${L}: not an enrichment response — the "_nce" field is missing.`]);

  if (v.batch == null) warnings.push(`${L}: no "batch" field — assuming batch ${part}.`);
  else if (Number(v.batch) !== part) {
    const other = Number(v.batch);
    return fail([`${L}: this response says "batch": ${JSON.stringify(v.batch)}` + (other >= 1 && other <= batches ? ` — paste it into ${labels[other]}.` : batches === 1 ? ' — expected 1.' : ' — expected 1 or 2.')]);
  }

  const extra = Object.keys(v).filter((k) => !NCE_KEYS.has(k));
  if (extra.length) warnings.push(`${L}: ignoring unexpected fields ${listIds(extra)}.`);

  let cols = NCE_COLS;
  if (v.E_cols != null) {
    if (!Array.isArray(v.E_cols) || !v.E_cols.every((c) => typeof c === 'string')) return fail([`${L}: "E_cols" must be an array of column names.`]);
    cols = v.E_cols;
    for (const need of ['ni', 'info']) if (!cols.includes(need)) errors.push(`${L}: "E_cols" must include "${need}".`);
    const extraCols = cols.filter((c) => !NCE_COLS.includes(c));
    if (extraCols.length) warnings.push(`${L}: ignoring unexpected columns ${listIds(extraCols)}.`);
  } else warnings.push(`${L}: no "E_cols" — assuming ${JSON.stringify(NCE_COLS)}.`);
  if (!Array.isArray(v.E)) errors.push(`${L}: "E" must be an array of rows.`);
  else if (!v.E.length) errors.push(`${L}: "E" has no rows — the response is empty.`);
  if (errors.length) return fail(errors, warnings);

  const [ni, di, ii, ai] = NCE_COLS.map((k) => cols.indexOf(k));
  const nce = Object.create(null);
  const ids = [];
  const dup = [];
  v.E.forEach((row, r) => {
    const at = `${L}: row ${r + 1}`;
    if (!Array.isArray(row)) return errors.push(`${at} must be an array.`);
    if (!isIdLike(row[ni])) return errors.push(`${at} has no concept id.`);
    const id = String(row[ni]);
    if (id in nce) { dup.push(id); return; }
    const desc = di >= 0 ? row[di] : undefined;
    const info = row[ii];
    const analogy = ai >= 0 ? row[ai] : undefined;
    if (desc != null && typeof desc !== 'string') errors.push(`${at} "${id}": desc must be a string.`);
    if (typeof info !== 'string' || !info.trim()) errors.push(`${at} "${id}": info is empty — every enriched concept needs its full explanation.`);
    if (analogy != null && typeof analogy !== 'string') errors.push(`${at} "${id}": analogy must be a string or null.`);
    // Same shape parseNCE produces, so mergeEnrichment keeps its historical behaviour.
    nce[id] = {
      description: typeof desc === 'string' ? desc : '',
      additionalInfo: typeof info === 'string' ? info : '',
      analogy: typeof analogy === 'string' ? analogy : null,
    };
    ids.push(id);
  });
  if (dup.length) errors.push(`${L}: concept ids repeated within this batch ${listIds([...new Set(dup)])}.`);

  if (skeleton) {
    const known = new Set(skeleton.nodes.map((n) => n.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) errors.push(`${L}: ${unknown.length} concept id(s) do not exist in the skeleton: ${listIds(unknown)}.`);
    const want = expectedId ?? `${topicSlug(skeleton.topic)}_${skeleton.depth}`;
    if (v._id != null && String(v._id) !== want) warnings.push(`${L}: "_id" is "${v._id}", expected "${want}" — check this batch belongs to this map.`);
    const expected = new Set(splitBatches(skeleton, batches)[part === 1 ? 'batch1' : 'batch2'].map((n) => n.id));
    const outside = ids.filter((id) => known.has(id) && !expected.has(id));
    if (outside.length) warnings.push(`${L}: ${outside.length} concept(s) belong to the other batch in the standard split: ${listIds(outside, 6)}.`);
  }

  return errors.length ? { ok: false, nce: null, ids, errors, warnings } : { ok: true, nce, ids, errors, warnings };
}

const sameEntry = (a, b) => a.description === b.description && a.additionalInfo === b.additionalInfo && (a.analogy ?? null) === (b.analogy ?? null);

/**
 * Validate and combine a skeleton with its data parts, merged in order (skeleton → Part 1 → Part 2).
 * texts: [skeleton, dataPart1, (dataPart2)] — `batches` is the number of data parts (1 or 2).
 *
 * requireComplete: true  → every part must be present and every concept must end up with an
 *                          explanation (manual import).
 * requireComplete: false → only the skeleton is required; absent parts are reported as warnings
 *                          with the concepts that still lack explanations (progressive generation).
 * A part that is present but invalid always blocks assembly.
 */
function assembleSkeletonParts(texts, { batches, depth, requireComplete = true, expectedId = null }) {
  const labels = labelsFor(batches);
  const sk = checkSkeleton(texts[0], { batches, depth });
  const base = sk.ok ? sk.map : null;
  const data = [];
  for (let i = 1; i <= batches; i++) data.push(checkEnrichment(texts[i], { part: i, batches, skeleton: base, expectedId }));
  const parts = [sk, ...data];
  const errors = [...sk.errors];
  const warnings = [...sk.warnings];
  for (const d of data) {
    warnings.push(...d.warnings);
    if (d.missing && !requireComplete) continue;
    errors.push(...d.errors);
  }
  const total = base ? base.nodes.length : 0;
  const result = (extra) => ({ ok: false, map: null, parts, errors, warnings, enriched: 0, total, missing: [], ...extra });
  if (!base) return result();

  // Cross-part checks only make sense between parts that are individually valid.
  const nces = data.map((d) => (d.ok ? d.nce : null));
  const [a, b] = nces;
  if (a && b) {
    const conflicts = [];
    const same = [];
    for (const id of Object.keys(a)) if (id in b) (sameEntry(a[id], b[id]) ? same : conflicts).push(id);
    if (conflicts.length) errors.push(`Conflict: ${conflicts.length} concept(s) appear in both ${labels[1]} and ${labels[2]} with different content: ${listIds(conflicts)}. Remove them from one part.`);
    if (same.length) warnings.push(`${same.length} concept(s) appear identically in both data parts: ${listIds(same, 6)}.`);
  }

  const covered = new Set(nces.flatMap((n) => (n ? Object.keys(n) : [])));
  const missing = base.nodes.filter((n) => !covered.has(n.id) && !n.additionalInfo.trim()).map((n) => n.id);
  const enriched = total - missing.length;
  if (missing.length) {
    const where = batches === 1 ? 'the data part' : 'either data part';
    const msg = `${missing.length} of ${total} concept(s) have no explanation in ${where}: ${listIds(missing)}.`;
    if (requireComplete) errors.push(msg); else warnings.push(msg);
  }
  if (errors.length) return result({ enriched, missing });

  // Merge in order, then run the result through the full single-map pipeline so it is
  // indistinguishable from one complete NCF paste.
  const merged = mergeEnrichment(base, ...nces);
  const final = loadMapFromObject(toNCF(merged));
  if (!final.ok) {
    errors.push(...final.errors.map((e) => `Assembled map: ${e}`));
    return result({ enriched, missing });
  }
  return { ok: true, map: final.data, parts, errors, warnings, enriched, total, missing };
}

/** Explorer: one complete map, through the existing single-map loader (unchanged behaviour). */
function assembleSingle(text, label) {
  const raw = typeof text === 'string' ? text : '';
  const part = (ok, extra) => ({ ok, missing: false, map: null, errors: [], warnings: [], ...extra });
  if (!raw.trim()) {
    const errors = [`${label} is missing — paste the complete JSON response.`];
    return { ok: false, map: null, parts: [part(false, { missing: true, errors })], errors, warnings: [], enriched: 0, total: 0, missing: [] };
  }
  const r = loadMapFromText(raw);
  if (!r.ok) {
    let errors = r.errors.map((e) => `${label}: ${e}`);
    if (r.kind === 'json' && !/[}\]]\s*$/.test(stripFences(raw))) {
      errors = [errors[0] + ' The response looks cut off before the end — ask the AI to continue from where it stopped, or regenerate it.'];
    }
    return { ok: false, map: null, parts: [part(false, { errors })], errors, warnings: [], enriched: 0, total: 0, missing: [] };
  }
  const total = r.data.nodes.length;
  return { ok: true, map: r.data, parts: [part(true, { map: r.data })], errors: [], warnings: [], enriched: total, total, missing: [] };
}

/**
 * One entry point for every depth. `texts` holds one string per part, in order
 * (Explorer: [map]; Practitioner: [skeleton, data]; Researcher: [skeleton, data1, data2]).
 * Returns { ok, map, parts[], errors, warnings, enriched, total, missing }.
 * `parts[i]` is that part's own result ({ ok, missing, errors, warnings, … }).
 */
export function assembleParts(depth, texts, { requireComplete = true, expectedId = null } = {}) {
  const mode = modeFor(depth);
  const t = Array.from({ length: mode.parts }, (_, i) => (texts && typeof texts[i] === 'string' ? texts[i] : ''));
  if (mode.parts === 1) return assembleSingle(t[0], mode.labels[0]);
  return assembleSkeletonParts(t, { batches: mode.batches, depth: MODES[depth] ? depth : 'researcher', requireComplete, expectedId });
}

/** Researcher three-part assembly (kept for existing callers and tests). */
export function assembleResearcherMap({ skeleton, part1, part2 }, opts = {}) {
  const r = assembleParts('researcher', [skeleton, part1, part2], opts);
  return { ...r, parts: { skeleton: r.parts[0], part1: r.parts[1], part2: r.parts[2] } };
}
