// NCF (Neuron Compact Format) and legacy JSON parsing, validation and sanitising.
// Every map — pasted, decrypted from the vault, or fetched by the public viewer — passes
// through loadMap*() so the rest of the app only ever sees a normalised, size-bounded model.

export const LIMITS = Object.freeze({
  textBytes: 8_000_000,
  categories: 40,
  nodes: 600,
  links: 4000,
  learningPath: 600,
  listItems: 60,
  id: 100,
  label: 160,
  short: 400,
  description: 4000,
  info: 80_000,
  summary: 8000,
});

const LINK_TYPES = new Set(['hierarchical', 'semantic', 'cross_domain']);
const FALLBACK_COLORS = ['#4fc3f7', '#c77dff', '#69f0ae', '#ffb74d', '#ff6b6b', '#00e5ff', '#9c64ff', '#f48fb1', '#a8ff78', '#ffd93d'];

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

export function stripFences(txt) {
  return String(txt).trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIdLike = (v) => (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v));

function str(v, max) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_CHARS, '').slice(0, max);
}

function num(v, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function safeColor(v, index = 0) {
  if (typeof v === 'string') {
    const m = v.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
      return '#' + h.toLowerCase();
    }
  }
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function strList(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((s) => typeof s === 'string').slice(0, LIMITS.listItems).map((s) => str(s, LIMITS.description)).filter(Boolean);
}

// ── NCF expansion (behaviour-compatible with the original parseNCF) ──

export function parseNCF(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!isObj(data)) throw new Error('Top level must be a JSON object');
  if (!data._ncf) return data; // legacy verbose format passes through

  for (const k of ['N_cols', 'L_cols', 'LP_cols']) {
    if (!Array.isArray(data[k])) throw new Error(`NCF: "${k}" must be an array of column names`);
  }
  for (const k of ['N', 'L', 'LP']) {
    if (data[k] != null && !Array.isArray(data[k])) throw new Error(`NCF: "${k}" must be an array of rows`);
  }

  const col = (cols, key) => cols.indexOf(key);
  const cell = (row, i) => (Array.isArray(row) && i >= 0 ? row[i] : undefined);

  const NC = data.N_cols;
  const nodes = (data.N || []).map((row) => ({
    id: cell(row, col(NC, 'id')),
    label: cell(row, col(NC, 'label')),
    category: cell(row, col(NC, 'cat')),
    hot: cell(row, col(NC, 'hot')) === 1 || cell(row, col(NC, 'hot')) === true,
    depth_level: cell(row, col(NC, 'dl')),
    description: cell(row, col(NC, 'desc')) || '',
    additionalInfo: cell(row, col(NC, 'info')) || '',
    prerequisites: cell(row, col(NC, 'prereq')) || [],
    analogy: cell(row, col(NC, 'analogy')) || null,
  }));

  const LC = data.L_cols;
  const links = (data.L || []).map((row) => ({
    source: cell(row, col(LC, 'src')),
    target: cell(row, col(LC, 'tgt')),
    relation: cell(row, col(LC, 'rel')),
    type: cell(row, col(LC, 'tp')),
    weight: cell(row, col(LC, 'w')),
    label: cell(row, col(LC, 'lbl')) || '',
  }));

  const LPC = data.LP_cols;
  const learningPath = (data.LP || []).map((row) => ({
    nodeId: cell(row, col(LPC, 'ni')),
    order: cell(row, col(LPC, 'o')),
    phase: cell(row, col(LPC, 'ph')),
    reason: cell(row, col(LPC, 'rs')),
    estimatedMinutes: cell(row, col(LPC, 'em')),
    keyInsight: cell(row, col(LPC, 'ki')) || '',
  }));

  const m = isObj(data.meta) ? data.meta : {};
  return {
    topic: data.topic,
    depth: data.depth,
    summary: data.summary,
    categories: data.categories || [],
    nodes,
    links,
    learningPath,
    metadata: {
      totalConcepts: m.tc,
      totalLinks: m.tl,
      centralNode: m.central,
      crossDomainInsights: m.insights || [],
      suggestedNextTopics: m.next || [],
      commonMisconceptions: m.misconceptions || [],
    },
  };
}

export function parseNCE(raw) {
  const data = JSON.parse(stripFences(raw));
  if (!isObj(data) || !data._nce) throw new Error('Not a valid NCE object — missing _nce field');
  const cols = Array.isArray(data.E_cols) ? data.E_cols : ['ni', 'desc', 'info', 'analogy'];
  const [ni, di, ii, ai] = ['ni', 'desc', 'info', 'analogy'].map((k) => cols.indexOf(k));
  if (ni < 0) throw new Error('NCE: E_cols must include "ni"');
  if (data.E != null && !Array.isArray(data.E)) throw new Error('NCE: "E" must be an array of rows');
  const map = Object.create(null);
  (data.E || []).forEach((row) => {
    if (!Array.isArray(row) || !isIdLike(row[ni])) return;
    map[String(row[ni])] = {
      description: typeof row[di] === 'string' ? row[di] : '',
      additionalInfo: typeof row[ii] === 'string' ? row[ii] : '',
      analogy: typeof row[ai] === 'string' ? row[ai] : null,
    };
  });
  return map;
}

export function mergeEnrichment(skeleton, ...enrichMaps) {
  const merged = Object.assign(Object.create(null), ...enrichMaps.filter(Boolean));
  return {
    ...skeleton,
    nodes: skeleton.nodes.map((node) => ({
      ...node,
      description: merged[node.id]?.description || node.description || '',
      additionalInfo: merged[node.id]?.additionalInfo || node.additionalInfo || '',
      analogy: merged[node.id]?.analogy ?? node.analogy ?? null,
    })),
  };
}

// ── Validation (original rules + type and size checks) ──

export function validateSchema(data) {
  const errors = [];
  if (!isObj(data)) return { ok: false, errors: ['Top level must be a JSON object'] };

  if (!data.topic) errors.push('Missing: topic');
  else if (typeof data.topic !== 'string') errors.push('topic: must be a string');
  if (!data.depth) errors.push('Missing: depth');
  else if (typeof data.depth !== 'string') errors.push('depth: must be a string');
  if (!data.summary) errors.push('Missing: summary');
  else if (typeof data.summary !== 'string') errors.push('summary: must be a string');

  if (!Array.isArray(data.categories) || data.categories.length < 2)
    errors.push('categories: must be array with 2+ items');
  else if (data.categories.length > LIMITS.categories)
    errors.push(`categories: at most ${LIMITS.categories} allowed`);

  if (!Array.isArray(data.nodes) || data.nodes.length < 5)
    errors.push('nodes: must be array with 5+ items');
  else if (data.nodes.length > LIMITS.nodes) errors.push(`nodes: at most ${LIMITS.nodes} allowed`);

  if (!Array.isArray(data.links) || data.links.length < 3)
    errors.push('links: must be array with 3+ items');
  else if (data.links.length > LIMITS.links) errors.push(`links: at most ${LIMITS.links} allowed`);

  if (!Array.isArray(data.learningPath) || data.learningPath.length < 1)
    errors.push('learningPath: must be non-empty array');
  else if (data.learningPath.length > LIMITS.learningPath)
    errors.push(`learningPath: at most ${LIMITS.learningPath} allowed`);

  if (errors.length) return { ok: false, errors };

  const catIds = new Set();
  data.categories.forEach((c, i) => {
    if (!isObj(c)) return errors.push(`categories[${i}]: must be an object`);
    if (!isIdLike(c.id)) errors.push(`categories[${i}]: missing id`);
    else catIds.add(String(c.id));
    if (typeof c.label !== 'string' || !c.label) errors.push(`categories[${i}]: missing label`);
  });

  const nodeIds = new Set();
  data.nodes.forEach((n) => { if (isObj(n) && isIdLike(n.id)) nodeIds.add(String(n.id)); });

  data.nodes.forEach((n, i) => {
    if (!isObj(n)) return errors.push(`nodes[${i}]: must be an object`);
    if (!isIdLike(n.id) || /\s/.test(String(n.id))) errors.push(`nodes[${i}]: id "${n.id}" has spaces`);
    else if (String(n.id).length > LIMITS.id) errors.push(`nodes[${i}]: id is longer than ${LIMITS.id} characters`);
    if (!n.label) errors.push(`nodes[${i}]: missing label`);
    else if (typeof n.label !== 'string') errors.push(`nodes[${i}] "${n.id}": label must be a string`);
    if (!catIds.has(String(n.category))) errors.push(`nodes[${i}] "${n.id}": category "${n.category}" not found`);
    if (n.prerequisites != null && !Array.isArray(n.prerequisites))
      errors.push(`nodes[${i}] "${n.id}": prerequisites must be an array`);
    else if (n.prerequisites) n.prerequisites.forEach((p) => {
      if (!nodeIds.has(String(p))) errors.push(`nodes[${i}] "${n.id}": prerequisite "${p}" not found`);
    });
    for (const k of ['description', 'additionalInfo', 'analogy']) {
      if (n[k] != null && typeof n[k] !== 'string') errors.push(`nodes[${i}] "${n.id}": ${k} must be a string`);
    }
  });

  data.links.forEach((l, i) => {
    if (!isObj(l)) return errors.push(`links[${i}]: must be an object`);
    if (!nodeIds.has(String(l.source))) errors.push(`links[${i}]: source "${l.source}" not found`);
    if (!nodeIds.has(String(l.target))) errors.push(`links[${i}]: target "${l.target}" not found`);
  });

  data.learningPath.forEach((lp, i) => {
    if (!isObj(lp)) return errors.push(`learningPath[${i}]: must be an object`);
    if (!nodeIds.has(String(lp.nodeId))) errors.push(`learningPath[${i}]: nodeId "${lp.nodeId}" not found`);
  });

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

// ── Sanitising: produce the normalised internal model ──

export function sanitizeMap(data) {
  const categories = [];
  const catSeen = new Set();
  data.categories.forEach((c, i) => {
    const id = str(c.id, LIMITS.id);
    if (!id || catSeen.has(id)) return;
    catSeen.add(id);
    categories.push({
      id,
      label: str(c.label, LIMITS.label),
      color: safeColor(c.color, i),
      icon: str(c.icon, 16).trim(),
      description: str(c.description, LIMITS.description),
    });
  });

  const nodes = [];
  const nodeSeen = new Set();
  for (const n of data.nodes) {
    const id = str(n.id, LIMITS.id);
    if (!id || nodeSeen.has(id)) continue;
    nodeSeen.add(id);
    nodes.push({
      id,
      label: str(n.label, LIMITS.label),
      category: str(n.category, LIMITS.id),
      hot: n.hot === true || n.hot === 1,
      depth_level: num(n.depth_level, { min: 1, max: 3, fallback: 1 }),
      description: str(n.description, LIMITS.description),
      additionalInfo: str(n.additionalInfo, LIMITS.info),
      prerequisites: (Array.isArray(n.prerequisites) ? n.prerequisites : [])
        .map((p) => str(p, LIMITS.id)).filter((p) => p && p !== id),
      analogy: typeof n.analogy === 'string' && n.analogy ? str(n.analogy, LIMITS.description) : null,
    });
  }

  const links = data.links.map((l) => ({
    source: str(l.source, LIMITS.id),
    target: str(l.target, LIMITS.id),
    relation: str(l.relation, 60),
    type: LINK_TYPES.has(l.type) ? l.type : 'semantic',
    weight: Math.round(num(l.weight, { min: 1, max: 3, fallback: 1 })),
    label: str(l.label, LIMITS.short),
  })).filter((l) => nodeSeen.has(l.source) && nodeSeen.has(l.target) && l.source !== l.target);

  const learningPath = [];
  data.learningPath.forEach((s, i) => {
    const nodeId = str(s.nodeId, LIMITS.id);
    if (!nodeSeen.has(nodeId)) return;
    learningPath.push({
      nodeId,
      order: num(s.order, { min: 0, max: 100_000, fallback: i + 1 }),
      phase: str(s.phase, LIMITS.label),
      reason: str(s.reason, LIMITS.description),
      estimatedMinutes: Math.round(num(s.estimatedMinutes, { min: 0, max: 10_000, fallback: 10 })),
      keyInsight: str(s.keyInsight, LIMITS.description),
    });
  });

  const m = isObj(data.metadata) ? data.metadata : {};
  const central = str(m.centralNode, LIMITS.id);
  return {
    topic: str(data.topic, LIMITS.label),
    depth: str(data.depth, 40).toLowerCase(),
    summary: str(data.summary, LIMITS.summary),
    categories,
    nodes,
    links,
    learningPath,
    metadata: {
      totalConcepts: nodes.length,
      totalLinks: links.length,
      centralNode: nodeSeen.has(central) ? central : null,
      crossDomainInsights: strList(m.crossDomainInsights),
      suggestedNextTopics: strList(m.suggestedNextTopics),
      commonMisconceptions: strList(m.commonMisconceptions),
    },
  };
}

/** Full pipeline for an already-parsed JSON value. Never throws. */
export function loadMapFromObject(obj) {
  let expanded;
  try {
    expanded = parseNCF(obj);
  } catch (e) {
    return { ok: false, kind: 'format', errors: [e.message] };
  }
  const result = validateSchema(expanded);
  if (!result.ok) return { ok: false, kind: 'schema', errors: result.errors };
  return { ok: true, data: sanitizeMap(expanded), errors: [] };
}

/** Full pipeline for pasted or fetched text. Never throws. */
export function loadMapFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, kind: 'empty', errors: ['Nothing to parse'] };
  if (text.length > LIMITS.textBytes) return { ok: false, kind: 'size', errors: ['Map is too large'] };
  let parsed;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch (e) {
    return { ok: false, kind: 'json', errors: [`Invalid JSON: ${e.message}`] };
  }
  return loadMapFromObject(parsed);
}

/** Convert the internal model back to compact NCF for export. */
export function toNCF(map) {
  return {
    _ncf: '1',
    topic: map.topic,
    depth: map.depth,
    summary: map.summary,
    categories: map.categories,
    N_cols: ['id', 'label', 'cat', 'hot', 'dl', 'desc', 'info', 'prereq', 'analogy'],
    N: map.nodes.map((n) => [n.id, n.label, n.category, n.hot ? 1 : 0, n.depth_level, n.description, n.additionalInfo, n.prerequisites, n.analogy]),
    L_cols: ['src', 'tgt', 'rel', 'tp', 'w', 'lbl'],
    L: map.links.map((l) => [l.source, l.target, l.relation, l.type, l.weight, l.label]),
    LP_cols: ['ni', 'o', 'ph', 'rs', 'em', 'ki'],
    LP: map.learningPath.map((s) => [s.nodeId, s.order, s.phase, s.reason, s.estimatedMinutes, s.keyInsight]),
    meta: {
      tc: map.metadata.totalConcepts,
      tl: map.metadata.totalLinks,
      central: map.metadata.centralNode,
      insights: map.metadata.crossDomainInsights,
      next: map.metadata.suggestedNextTopics,
      misconceptions: map.metadata.commonMisconceptions,
    },
  };
}
