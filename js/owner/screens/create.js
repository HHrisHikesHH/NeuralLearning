// New map: topic + depth, then generate a prompt (or paste existing JSON), validate, visualise.
// Ported from the original landing and prompt screens; the researcher depth keeps the
// three-part skeleton + enrichment flow.

import { el, clear, copyText, flashButton, put } from '../../core/dom.js';
import { SCHEMA_DISPLAY, buildPrompt, buildSkeletonPrompt, buildEnrichPrompt } from '../../core/prompts.js';
import { loadMapFromText, parseNCE, mergeEnrichment, sanitizeMap, stripFences } from '../../core/ncf.js';
import { confirmDialog } from '../ui.js';

const DEPTHS = [
  { id: 'explorer', icon: '🌍', name: 'Explorer', hint: '~15 concepts · the big picture' },
  { id: 'practitioner', icon: '🔬', name: 'Practitioner', hint: '~40 concepts · patterns & insights' },
  { id: 'researcher', icon: '🧬', name: 'Researcher', hint: '~80 concepts · cross-domain depth' },
];

export function newDraft({ topic, depth, fromJson }) {
  return {
    topic, depth, fromJson, multi: depth === 'researcher' && !fromJson,
    map: null, skeleton: null, enrich: [null, null], texts: ['', '', ''], pasteText: '',
    savedId: null, title: null, dirty: false, progress: [],
  };
}

export function renderNew(root, { app, navigate }) {
  let depth = app.draft?.depth && !app.draft.map ? app.draft.depth : 'explorer';
  const topic = el('input', { class: 'input', id: 'topic-input', maxlength: '80', placeholder: 'e.g. Quantum Computing, Stoicism, System Design…', autocomplete: 'off' });
  if (app.draft && !app.draft.map && !app.draft.fromJson) topic.value = app.draft.topic || '';
  const topicErr = el('small', { class: 'notice notice-err', hidden: true, id: 'topic-err' }, 'Enter a topic first.');

  const group = el('div', { class: 'depth-group', role: 'radiogroup', 'aria-label': 'Depth level' });
  const opts = DEPTHS.map((d) => {
    const b = el('button', {
      class: 'depth-opt', type: 'button', role: 'radio', 'aria-checked': String(d.id === depth), tabindex: d.id === depth ? '0' : '-1',
      on: { click: () => pick(d.id), keydown: onKey },
    }, el('span', { class: 'd-icon', 'aria-hidden': 'true' }, d.icon), el('span', { class: 'd-name' }, d.name.toUpperCase()), el('span', { class: 'd-hint' }, d.hint));
    b.dataset.depth = d.id;
    return b;
  });
  put(group, ...opts);
  function pick(id, focus = false) {
    depth = id;
    opts.forEach((b) => { const on = b.dataset.depth === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
  }
  function onKey(e) {
    const i = DEPTHS.findIndex((d) => d.id === depth);
    if (['ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); pick(DEPTHS[(i + 1) % 3].id, true); }
    if (['ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); pick(DEPTHS[(i + 2) % 3].id, true); }
  }

  async function start(fromJson) {
    const t = topic.value.trim();
    if (!fromJson && !t) {
      topic.setAttribute('aria-invalid', 'true');
      topic.setAttribute('aria-describedby', 'topic-err');
      topicErr.hidden = false;
      topic.focus();
      return;
    }
    if (app.draft?.dirty && !app.draft.savedId && !(await confirmDialog({ title: 'Discard unsaved map?', text: `“${app.draft.map?.topic || app.draft.topic}” has not been saved.`, confirmLabel: 'Discard', danger: true }))) return;
    app.draft = newDraft({ topic: fromJson ? 'Custom JSON map' : t, depth, fromJson });
    navigate('#/build');
  }
  topic.addEventListener('input', () => { topic.removeAttribute('aria-invalid'); topicErr.hidden = true; });
  topic.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(false); });

  put(root, el('div', { class: 'page page-narrow' },
    el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, 'New knowledge map')),
    el('section', { class: 'card' },
      el('label', { class: 'field' }, el('span', {}, 'Topic to explore'), topic, topicErr),
      el('div', { class: 'field' }, el('span', { id: 'depth-label' }, 'Depth level'), group),
      el('div', { class: 'stack' },
        el('button', { class: 'btn btn-primary btn-block', type: 'button', on: { click: () => start(false) } }, 'Generate knowledge prompt →'),
        el('button', { class: 'btn btn-ghost btn-block', type: 'button', on: { click: () => start(true) } }, 'Already have JSON? Paste & visualise →'))),
    el('p', { class: 'muted' }, 'Neuron writes a detailed prompt for any AI assistant (Claude, GPT, Gemini…). Paste its JSON answer back here to build the map.')));
  requestAnimationFrame(() => topic.focus());
}

function copyRow(getText) {
  const btn = el('button', { class: 'btn btn-sm', type: 'button' }, '⎘ Copy prompt');
  btn.addEventListener('click', async () => {
    const ok = await copyText(getText());
    flashButton(btn, ok ? '✓ Copied' : 'Select the text and press Ctrl+C');
  });
  return btn;
}

function errorNotice(text) {
  const pre = el('pre', {}, text);
  const btn = el('button', { class: 'btn btn-sm', type: 'button', on: { click: async () => flashButton(btn, (await copyText(text)) ? '✓ Copied' : 'Copy failed') } }, '⎘ Copy error');
  return el('div', { class: 'notice notice-err', role: 'alert' },
    el('p', {}, 'No need to worry — AI models make mistakes. Copy this error and paste it back to the AI; it will fix the JSON.'), pre, el('div', { class: 'row', style: { 'margin-top': '8px' } }, btn));
}

function schemaToggle() {
  const box = el('pre', { class: 'prompt-box schema-box', hidden: true, id: 'schema-box', tabindex: '0' }, SCHEMA_DISPLAY);
  const btn = el('button', { class: 'link-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'schema-box' }, 'View expected JSON schema');
  btn.addEventListener('click', () => { box.hidden = !box.hidden; btn.setAttribute('aria-expanded', String(!box.hidden)); });
  return el('div', {}, btn, box);
}

export function renderBuild(root, { app, navigate }) {
  const d = app.draft;
  const page = el('div', { class: 'page' });
  put(root, page);
  const back = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => navigate(d.savedId ? `#/map/${d.savedId}` : '#/new') } }, '← Back');
  put(page, el('div', { class: 'page-head' },
    el('div', { class: 'row' }, back, el('h1', { class: 'page-title' }, d.fromJson ? 'Paste your map JSON' : ['Build map for ', el('span', { class: 'muted' }, `“${d.topic}”`)])),
    el('span', { class: 'badge badge-accent' }, d.depth.toUpperCase())));

  if (d.multi) return renderMulti(page, app, navigate);

  const pills = el('ol', { class: 'step-pills', 'aria-label': 'Progress' });
  const pill = (t, cls) => { const p = el('li', { class: ['step-pill', cls] }, t); put(pills, p); return p; };
  if (!d.fromJson) pill('✓ Topic defined', 'done');
  const pCopy = d.fromJson ? null : pill('① Copy prompt', 'active');
  const pPaste = pill(d.fromJson ? '① Paste result' : '② Paste result', d.fromJson ? 'active' : '');
  const pLaunch = pill(d.fromJson ? '② Launch map' : '③ Launch map', '');
  put(page, pills);

  if (!d.fromJson) {
    const prompt = buildPrompt(d.topic, d.depth);
    const copy = copyRow(() => prompt);
    copy.addEventListener('click', () => { pCopy.className = 'step-pill done'; pPaste.classList.add('active'); });
    put(page, el('section', { class: 'card' },
      el('h2', { class: 'label' }, 'Step 1 — Copy this prompt into any AI'),
      el('pre', { class: 'prompt-box', tabindex: '0', 'aria-label': 'Generated prompt' }, prompt),
      el('div', { class: 'row' }, copy, el('div', { class: 'llm-chips' }, 'Works with', ...['Claude', 'GPT', 'Gemini', 'Mistral'].map((m) => el('span', { class: 'chip' }, m))))));
  }

  const area = el('textarea', { class: 'textarea', id: 'json-paste', placeholder: 'Paste the full JSON response from the AI here…', spellcheck: 'false', 'aria-describedby': 'val-msg' });
  area.value = d.pasteText || '';
  const msg = el('div', { id: 'val-msg', 'aria-live': 'polite' });
  const launch = el('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true }, '⬡ Visualise knowledge graph →');
  let parsed = null;

  function validate() {
    d.pasteText = area.value;
    clear(msg);
    parsed = null;
    launch.disabled = true;
    pLaunch.classList.remove('active');
    if (!area.value.trim()) return;
    const r = loadMapFromText(area.value);
    if (!r.ok) {
      put(msg, errorNotice(r.kind === 'schema' ? `Schema errors:\n${r.errors.join('\n')}` : r.errors.join('\n')));
      return;
    }
    parsed = r.data;
    put(msg, el('div', { class: 'notice notice-ok' }, `✓ Valid — ${r.data.nodes.length} concepts · ${r.data.links.length} links · ${r.data.learningPath.length} learning steps`));
    launch.disabled = false;
    pLaunch.classList.add('active');
  }
  let t;
  area.addEventListener('input', () => { clearTimeout(t); t = setTimeout(validate, 400); });
  launch.addEventListener('click', () => {
    if (!parsed) return;
    d.map = parsed;
    d.topic = parsed.topic;
    d.dirty = true;
    navigate('#/draft');
  });

  put(page, el('section', { class: 'card' },
    el('label', { class: 'field' }, el('span', { class: 'label' }, d.fromJson ? 'Paste the JSON here' : 'Step 2 — Paste the JSON output here'), area),
    msg, schemaToggle()), launch);
  if (area.value) validate();
  return () => clearTimeout(t);
}

function renderMulti(page, app, navigate) {
  const d = app.draft;
  const slots = [];
  const hint = el('p', { class: 'muted', 'aria-live': 'polite' }, 'The graph renders after the skeleton · explanations fill in after batches A & B');
  const launch = el('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true }, '⬡ Visualise knowledge graph →');

  const meta = [
    { title: 'Skeleton', sub: 'Structure only · the graph renders right after this' },
    { title: 'Enrich — Batch A', sub: 'Unlocks after the skeleton' },
    { title: 'Enrich — Batch B', sub: 'Unlocks after batch A' },
  ];
  meta.forEach((m, i) => {
    const prompt = el('pre', { class: 'prompt-box', tabindex: '0' }, i === 0 ? buildSkeletonPrompt(d.topic, d.depth) : 'Waiting for the skeleton…');
    const copy = copyRow(() => prompt.textContent);
    const area = el('textarea', { class: 'textarea', spellcheck: 'false', placeholder: i === 0 ? 'Paste the skeleton NCF response here…' : 'Paste the NCE enrichment response here…' });
    area.value = d.texts[i] || '';
    const status = el('div', { 'aria-live': 'polite' });
    const badge = el('span', { class: 'mp-badge' }, String(i + 1));
    const slot = el('section', { class: 'card mp-slot' },
      el('div', { class: 'mp-slot-head' }, badge, el('div', {}, el('h2', { class: 'card-title' }, m.title), el('p', { class: 'muted' }, m.sub))),
      prompt, el('div', { class: 'row' }, copy), area, status);
    slots.push({ slot, prompt, copy, area, status, badge });
    let t;
    area.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => handle(i), 500); });
  });

  function setState(i, s) {
    const x = slots[i];
    x.slot.classList.toggle('is-active', s === 'active');
    x.slot.classList.toggle('is-done', s === 'done');
    const locked = s === 'locked';
    x.slot.setAttribute('aria-disabled', String(locked));
    x.area.disabled = locked;
    x.copy.disabled = locked;
    x.badge.textContent = s === 'done' ? '✓' : String(i + 1);
  }

  function updateLaunch() {
    if (!d.skeleton) { launch.disabled = true; return; }
    const total = d.skeleton.nodes.length;
    const enriched = d.enrich.filter(Boolean).reduce((s, m) => s + Object.keys(m).length, 0);
    launch.disabled = false;
    if (enriched >= total) { launch.textContent = '⬡ Visualise full graph →'; hint.textContent = 'All concepts enriched — full explanations ready'; }
    else if (enriched) { launch.textContent = `⬡ Visualise (${enriched}/${total} enriched) →`; hint.textContent = `${enriched} of ${total} concepts have full explanations so far`; }
    else { launch.textContent = '⬡ Visualise skeleton →'; hint.textContent = `${total} concepts loaded — add batches A & B for full explanations`; }
  }

  function handle(i) {
    const x = slots[i];
    d.texts[i] = x.area.value;
    clear(x.status);
    const txt = stripFences(x.area.value);
    if (!txt) return;
    if (i === 0) {
      const r = loadMapFromText(txt);
      if (!r.ok) { put(x.status, errorNotice(r.errors.slice(0, 12).join('\n'))); return; }
      d.skeleton = r.data;
      put(x.status, el('div', { class: 'notice notice-ok' }, `✓ Skeleton: ${r.data.nodes.length} concepts · ${r.data.links.length} links · graph ready`));
      setState(0, 'done');
      slots[1].prompt.textContent = buildEnrichPrompt(d.topic, d.depth, d.skeleton, 1);
      slots[2].prompt.textContent = buildEnrichPrompt(d.topic, d.depth, d.skeleton, 2);
      setState(1, d.enrich[0] ? 'done' : 'active');
      setState(2, d.enrich[1] ? 'done' : d.enrich[0] ? 'active' : 'locked');
    } else {
      let nce;
      try { nce = parseNCE(txt); } catch (e) { put(x.status, errorNotice(`NCE error: ${e.message}`)); return; }
      d.enrich[i - 1] = nce;
      put(x.status, el('div', { class: 'notice notice-ok' }, `✓ ${Object.keys(nce).length} concepts enriched`));
      setState(i, 'done');
      if (i === 1 && !d.enrich[1]) setState(2, 'active');
    }
    updateLaunch();
  }

  launch.addEventListener('click', () => {
    if (!d.skeleton) return;
    const enrich = d.enrich.filter(Boolean);
    d.map = enrich.length ? sanitizeMap(mergeEnrichment(d.skeleton, ...enrich)) : d.skeleton;
    d.dirty = true;
    navigate('#/draft');
  });

  setState(0, 'active');
  setState(1, 'locked');
  setState(2, 'locked');
  put(page, el('div', { class: 'mp-grid' }, ...slots.map((s) => s.slot)), hint, launch);
  slots.forEach((s, i) => { if (s.area.value) handle(i); });
}
