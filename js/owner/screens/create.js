// New map: topic + depth, then generate a prompt (or paste existing JSON), validate, visualise.
// Ported from the original landing and prompt screens. The researcher depth keeps the
// three-part Skeleton + Data Part 1 + Data Part 2 flow, either generated step by step with the
// AI or pasted in one go from responses the owner already has (see core/multipart.js).

import { el, clear, copyText, flashButton, put } from '../../core/dom.js';
import { SCHEMA_DISPLAY, buildPrompt, buildSkeletonPrompt, buildEnrichPrompt } from '../../core/prompts.js';
import { loadMapFromText } from '../../core/ncf.js';
import { assembleResearcherMap, topicSlug } from '../../core/multipart.js';
import { confirmDialog } from '../ui.js';

const DEPTHS = [
  { id: 'explorer', icon: '🌍', name: 'Explorer', hint: '~15 concepts · the big picture' },
  { id: 'practitioner', icon: '🔬', name: 'Practitioner', hint: '~40 concepts · patterns & insights' },
  { id: 'researcher', icon: '🧬', name: 'Researcher', hint: '~80 concepts · cross-domain depth' },
];

export function newDraft({ topic, depth, fromJson }) {
  return {
    topic, depth, fromJson, multi: depth === 'researcher',
    // 'generate': prompts + step-by-step pasting; 'import': paste three existing responses.
    mpMode: fromJson ? 'import' : 'generate',
    map: null, texts: ['', '', ''], pasteText: '',
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
    el('p', { class: 'muted' }, 'Neuron writes a detailed prompt for any AI assistant (Claude, GPT, Gemini…). Paste its JSON answer back here to build the map. With Researcher selected, “Already have JSON?” takes the three Researcher responses (skeleton + two data parts).')));
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
    el('div', { class: 'row' }, back, el('h1', { class: 'page-title' }, d.fromJson ? (d.multi ? 'Import a three-part Researcher map' : 'Paste your map JSON') : ['Build map for ', el('span', { class: 'muted' }, `“${d.topic}”`)])),
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
    msg, schemaToggle(),
    d.fromJson ? el('p', { class: 'muted' }, 'Have the three Researcher responses (skeleton + Data Part 1 + Data Part 2) instead? ',
      el('button', { class: 'link-btn', type: 'button', on: { click: () => { Object.assign(d, { depth: 'researcher', multi: true, mpMode: 'import' }); app.refreshView(); } } }, 'Import three parts')) : null),
    launch);
  if (area.value) validate();
  return () => clearTimeout(t);
}

// Researcher three-part screen. One screen, two modes sharing the same three inputs:
//  generate: copy each prompt in turn; the graph can be visualised after the skeleton and
//            enriched progressively (historical behaviour), with missing explanations named.
//  import:   paste three existing responses in any order; the map only renders once all three
//            are valid and every concept has its explanation.
function renderMulti(page, app, navigate) {
  const d = app.draft;
  const canGenerate = !d.fromJson;
  if (!canGenerate) d.mpMode = 'import';
  const timers = [];
  let last = null;

  const modeBtns = [
    { id: 'generate', label: 'Generate with AI' },
    { id: 'import', label: 'Paste existing responses' },
  ].map((m) => {
    const b = el('button', { class: 'seg-opt', type: 'button', 'aria-pressed': String(d.mpMode === m.id), on: { click: () => setMode(m.id) } }, m.label);
    b.dataset.mode = m.id;
    return b;
  });
  const modeIntro = el('p', { class: 'muted', 'aria-live': 'polite' });
  const head = canGenerate
    ? el('div', { class: 'stack' }, el('div', { class: 'seg', role: 'group', 'aria-label': 'Researcher workflow' }, ...modeBtns), modeIntro)
    : el('p', { class: 'muted' }, 'Paste the three Researcher responses you already have — the topic comes from the skeleton. Need the prompts? ',
      el('a', { class: 'link-btn', href: '#/new' }, 'Start from a topic'), '.');

  const meta = [
    { title: 'Skeleton', importTitle: 'Skeleton JSON', sub: 'Structure only · the graph renders right after this', importSub: 'Part 1 of 3 · NCF with every concept, link and learning step' },
    { title: 'Enrich — Data Part 1', importTitle: 'Data Part 1 JSON', sub: 'Unlocks after the skeleton', importSub: 'Part 2 of 3 · NCE batch 1' },
    { title: 'Enrich — Data Part 2', importTitle: 'Data Part 2 JSON', sub: 'Unlocks after Data Part 1', importSub: 'Part 3 of 3 · NCE batch 2' },
  ];
  const slots = meta.map((m, i) => {
    const prompt = el('pre', { class: 'prompt-box', tabindex: '0', 'aria-label': `${m.title} prompt` }, i === 0 && canGenerate ? buildSkeletonPrompt(d.topic, d.depth) : 'Waiting for the skeleton…');
    const copy = copyRow(() => prompt.textContent);
    const area = el('textarea', { class: 'textarea', spellcheck: 'false', id: `mp-paste-${i}`, placeholder: i === 0 ? 'Paste the skeleton NCF JSON response here…' : `Paste the Data Part ${i} (NCE) JSON response here…` });
    area.value = d.texts[i] || '';
    const status = el('div', { 'aria-live': 'polite' });
    const badge = el('span', { class: 'mp-badge', 'aria-hidden': 'true' }, String(i + 1));
    const title = el('h2', { class: 'card-title' });
    const sub = el('p', { class: 'muted' });
    const label = el('label', { class: 'sr-only', for: area.id });
    const promptWrap = el('div', { class: 'stack' }, prompt, el('div', { class: 'row' }, copy));
    const slot = el('section', { class: 'card mp-slot' },
      el('div', { class: 'mp-slot-head' }, badge, el('div', {}, title, sub)), promptWrap, label, area, status);
    area.addEventListener('input', () => { clearTimeout(timers[i]); timers[i] = setTimeout(refresh, 500); });
    return { m, slot, prompt, promptWrap, copy, area, status, badge, title, sub, label };
  });

  const assembly = el('div', { 'aria-live': 'polite', class: 'stack' });
  const hint = el('p', { class: 'muted', 'aria-live': 'polite' });
  const launch = el('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true }, '⬡ Visualise knowledge graph →');

  function setMode(mode) {
    d.mpMode = mode;
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    refresh();
  }

  function setState(i, s) {
    const x = slots[i];
    x.slot.classList.toggle('is-active', s === 'active');
    x.slot.classList.toggle('is-done', s === 'done');
    x.slot.classList.toggle('is-err', s === 'err');
    const locked = s === 'locked';
    x.slot.setAttribute('aria-disabled', String(locked));
    x.area.disabled = locked;
    x.copy.disabled = locked;
    x.badge.textContent = s === 'done' ? '✓' : s === 'err' ? '!' : String(i + 1);
  }

  function refresh() {
    const gen = d.mpMode === 'generate';
    slots.forEach((x) => { d.texts[slots.indexOf(x)] = x.area.value; });
    const [t0, t1, t2] = d.texts;
    last = assembleResearcherMap({ skeleton: t0, part1: t1, part2: t2 }, {
      requireComplete: !gen,
      expectedId: gen ? `${topicSlug(d.topic)}_${d.depth}` : null,
    });
    const r = last;
    const res = [r.parts.skeleton, r.parts.part1, r.parts.part2];
    const skOk = res[0].ok;

    modeIntro.textContent = gen
      ? 'Copy each prompt into your AI in turn and paste its answer below it. The graph can be visualised after the skeleton; the two data parts fill in the explanations.'
      : 'Already have all three responses? Paste each one into its box — in any order. The map renders once all three are valid and complete.';

    const shown = new Set();
    slots.forEach((x, i) => {
      x.title.textContent = gen ? x.m.title : x.m.importTitle;
      x.sub.textContent = gen ? x.m.sub : x.m.importSub;
      x.label.textContent = gen ? `Paste the ${x.m.title} response` : x.m.importTitle;
      x.promptWrap.hidden = !gen;
      clear(x.status);
      const p = res[i];
      const has = !!d.texts[i].trim();
      if (has && p.errors.length) {
        p.errors.forEach((e) => shown.add(e));
        put(x.status, errorNotice(p.errors.slice(0, 15).join('\n') + (p.errors.length > 15 ? `\n… and ${p.errors.length - 15} more` : '')));
      } else if (has) {
        const text = i === 0
          ? `✓ Skeleton: ${p.map.nodes.length} concepts · ${p.map.links.length} links · ${p.map.learningPath.length} learning steps`
          : `✓ Data Part ${i}: ${p.ids.length} concepts enriched` + (skOk ? '' : ' — waiting for the skeleton to cross-check');
        put(x.status, el('div', { class: 'notice notice-ok' }, text));
      }
    });

    if (gen) {
      slots[1].prompt.textContent = skOk ? buildEnrichPrompt(d.topic, d.depth, res[0].map, 1) : 'Waiting for the skeleton…';
      slots[2].prompt.textContent = skOk ? buildEnrichPrompt(d.topic, d.depth, res[0].map, 2) : 'Waiting for the skeleton…';
    }
    const stateOf = (i) => {
      const has = !!d.texts[i].trim();
      if (has && res[i].errors.length) return 'err';
      if (has && res[i].ok) return 'done';
      return 'active';
    };
    setState(0, stateOf(0));
    if (gen) {
      setState(1, skOk ? stateOf(1) : 'locked');
      setState(2, skOk && res[1].ok ? stateOf(2) : 'locked');
    } else {
      setState(1, stateOf(1));
      setState(2, stateOf(2));
    }

    // Problems that are not already shown on a slot: cross-part conflicts, missing parts in
    // import mode, missing explanations, and anything from the final whole-map validation.
    clear(assembly);
    const cross = r.errors.filter((e) => !shown.has(e));
    const anyText = d.texts.some((t) => t.trim());
    if (cross.length && anyText) {
      put(assembly, el('div', { class: 'notice notice-err', role: 'alert' },
        el('strong', {}, 'Cannot assemble the map yet'),
        el('ul', { class: 'issue-list' }, ...cross.slice(0, 12).map((e) => el('li', {}, e)), cross.length > 12 ? el('li', {}, `… and ${cross.length - 12} more`) : null)));
    }
    if (r.warnings.length && skOk) {
      put(assembly, el('details', { class: 'notice notice-warn' },
        el('summary', {}, `${r.warnings.length} note${r.warnings.length > 1 ? 's' : ''} to check`),
        el('ul', { class: 'issue-list' }, ...r.warnings.map((w) => el('li', {}, w)))));
    }

    launch.disabled = !r.ok;
    if (!r.ok) {
      launch.textContent = '⬡ Visualise knowledge graph →';
      hint.textContent = gen
        ? (skOk ? 'Fix the problems above to continue.' : 'The graph renders after the skeleton · explanations fill in after Data Parts 1 & 2')
        : 'Paste all three parts — Neuron validates each one, then combines them.';
    } else if (r.enriched >= r.total) {
      launch.textContent = '⬡ Visualise full graph →';
      hint.textContent = `All ${r.total} concepts enriched — full explanations ready`;
    } else if (r.enriched) {
      launch.textContent = `⬡ Visualise (${r.enriched}/${r.total} enriched) →`;
      hint.textContent = `${r.total - r.enriched} of ${r.total} concepts still have no explanation — add the remaining data part, or visualise now and come back via ← Build`;
    } else {
      launch.textContent = '⬡ Visualise skeleton →';
      hint.textContent = `${r.total} concepts loaded, none explained yet — add Data Parts 1 & 2 for full explanations`;
    }
  }

  launch.addEventListener('click', () => {
    timers.forEach(clearTimeout);
    refresh();
    if (!last?.ok) return;
    d.map = last.map;
    if (d.mpMode === 'import' || d.fromJson) d.topic = last.map.topic;
    d.dirty = true;
    navigate('#/draft');
  });

  put(page, head, el('div', { class: 'mp-grid' }, ...slots.map((s) => s.slot)), assembly, hint, launch);
  refresh();
  return () => timers.forEach(clearTimeout);
}
