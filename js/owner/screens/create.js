// New map: topic + depth, then generate a prompt (or paste existing JSON), validate, visualise.
// The number of AI responses follows the depth (core/modes.js): Explorer 1 complete map,
// Practitioner 2 (skeleton + data part), Researcher 3 (skeleton + two data parts). Multi-part maps
// can be generated step by step with the AI or pasted in one go from responses the owner already
// has; every depth assembles through core/multipart.js#assembleParts.

import { el, clear, copyText, flashButton, put } from '../../core/dom.js';
import { SCHEMA_DISPLAY, buildPrompt, buildSkeletonPrompt, buildEnrichPrompt } from '../../core/prompts.js';
import { assembleParts, topicSlug } from '../../core/multipart.js';
import { modeFor } from '../../core/modes.js';
import { confirmDialog } from '../ui.js';

const DEPTHS = [
  { id: 'explorer', icon: '🌍', name: 'Explorer', hint: '~15 concepts · the big picture · 1 AI response' },
  { id: 'practitioner', icon: '🔬', name: 'Practitioner', hint: '~40 concepts · patterns & insights · 2 AI responses' },
  { id: 'researcher', icon: '🧬', name: 'Researcher', hint: '~80 concepts · cross-domain depth · 3 AI responses' },
];
const depthName = (id) => DEPTHS.find((d) => d.id === id)?.name || id;
const COUNT_WORDS = ['zero', 'one', 'two', 'three'];

export function newDraft({ topic, depth, fromJson }) {
  return {
    topic, depth, fromJson, multi: modeFor(depth).parts > 1,
    // 'generate': prompts + step-by-step pasting; 'import': paste existing responses in one go.
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
    el('p', { class: 'muted' }, 'Neuron writes a detailed prompt for any AI assistant (Claude, GPT, Gemini…). Paste its JSON answer back here to build the map. Bigger maps are split so each answer fits a free model’s output limit: Explorer needs 1 response, Practitioner 2 (skeleton + data), Researcher 3 (skeleton + two data parts). “Already have JSON?” opens the matching number of inputs.')));
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
  const mode = modeFor(d.depth);
  const parts = d.multi ? mode.parts : 1;
  const page = el('div', { class: 'page' });
  put(root, page);
  const back = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => navigate(d.savedId ? `#/map/${d.savedId}` : '#/new') } }, '← Back');
  // "PRACTITIONER · 1/2 complete": which depth, how many responses, how many are valid so far.
  const progress = el('span', { class: 'badge parts-progress', id: 'parts-progress', 'aria-live': 'polite' });
  const setProgress = (done) => {
    progress.textContent = `${done}/${parts} complete`;
    progress.classList.toggle('badge-green', done === parts);
  };
  const title = d.fromJson
    ? (d.multi ? `Import a ${parts}-part ${depthName(d.depth)} map` : 'Paste your map JSON')
    : ['Build map for ', el('span', { class: 'muted' }, `“${d.topic}”`)];
  put(page, el('div', { class: 'page-head' },
    el('div', { class: 'row' }, back, el('h1', { class: 'page-title' }, title)),
    el('div', { class: 'row parts-head' }, el('span', { class: 'badge badge-accent' }, d.depth.toUpperCase()), progress)));
  setProgress(0);

  if (d.multi) return renderMulti(page, app, navigate, setProgress);

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
    setProgress(0);
    if (!area.value.trim()) return;
    // One complete map, through the same entry point as the multi-part depths.
    const r = assembleParts('explorer', [area.value]);
    if (!r.ok) {
      put(msg, errorNotice(r.errors.join('\n')));
      return;
    }
    parsed = r.map;
    setProgress(1);
    put(msg, el('div', { class: 'notice notice-ok' }, `✓ Valid — ${r.map.nodes.length} concepts · ${r.map.links.length} links · ${r.map.learningPath.length} learning steps`));
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

  const toParts = (depth) => el('button', {
    class: 'link-btn', type: 'button',
    on: { click: () => { Object.assign(d, { depth, multi: true, mpMode: 'import' }); app.refreshView(); } },
  }, `Import ${modeFor(depth).parts} parts (${depthName(depth)})`);
  put(page, el('section', { class: 'card' },
    el('label', { class: 'field' }, el('span', { class: 'label' }, d.fromJson ? 'Paste the JSON here' : 'Step 2 — Paste the JSON output here'), area),
    msg, schemaToggle(),
    d.fromJson ? el('p', { class: 'muted' }, 'Have the separate responses of a multi-part map instead? ', toParts('practitioner'), ' · ', toParts('researcher')) : null),
    launch);
  if (area.value) validate();
  return () => clearTimeout(t);
}

// Multi-part screen (Practitioner: 2 parts, Researcher: 3), built from the depth's mode.
// One screen, two modes sharing the same inputs:
//  generate: copy each prompt in turn; the graph can be visualised after the skeleton and
//            enriched progressively (historical behaviour), with missing explanations named.
//  import:   paste existing responses in any order; the map only renders once every part is
//            valid and every concept has its explanation.
function renderMulti(page, app, navigate, setProgress) {
  const d = app.draft;
  const mode = modeFor(d.depth);
  const n = mode.parts;
  const name = depthName(d.depth);
  const word = COUNT_WORDS[n];
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
    ? el('div', { class: 'stack' }, el('div', { class: 'seg', role: 'group', 'aria-label': `${name} workflow` }, ...modeBtns), modeIntro)
    : el('p', { class: 'muted' }, `Paste the ${word} ${name} responses you already have — the topic comes from the skeleton. Need the prompts? `,
      el('a', { class: 'link-btn', href: '#/new' }, 'Start from a topic'), '.');

  const dataNames = n === 2 ? 'the data part' : 'Data Parts 1 & 2';
  const meta = mode.labels.map((label, i) => (i === 0
    ? { label, title: 'Skeleton', importTitle: 'Skeleton JSON', sub: 'Structure only · the graph renders right after this', importSub: `Part 1 of ${n} · NCF with every concept, link and learning step` }
    : {
      label,
      title: `Enrich — ${label}`,
      importTitle: `${label} JSON`,
      sub: i === 1 ? 'Unlocks after the skeleton' : `Unlocks after ${mode.labels[i - 1]}`,
      importSub: `Part ${i + 1} of ${n} · ${n === 2 ? 'NCE explanations for every concept' : `NCE batch ${i}`}`,
    }));
  const slots = meta.map((m, i) => {
    const prompt = el('pre', { class: 'prompt-box', tabindex: '0', 'aria-label': `${m.title} prompt` }, i === 0 && canGenerate ? buildSkeletonPrompt(d.topic, d.depth, n) : 'Waiting for the skeleton…');
    const copy = copyRow(() => prompt.textContent);
    const area = el('textarea', { class: 'textarea', spellcheck: 'false', id: `mp-paste-${i}`, placeholder: i === 0 ? 'Paste the skeleton NCF JSON response here…' : `Paste the ${m.label} (NCE) JSON response here…` });
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
  const partsLine = el('p', { class: 'parts-line', id: 'parts-line', 'aria-live': 'polite' });
  const hint = el('p', { class: 'muted', 'aria-live': 'polite' });
  const launch = el('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true }, '⬡ Visualise knowledge graph →');
  const single = el('p', { class: 'muted' }, 'Have one complete JSON map instead? ',
    el('button', { class: 'link-btn', type: 'button', on: { click: () => { Object.assign(d, { multi: false, fromJson: true }); app.refreshView(); } } }, 'Paste a single JSON'));

  function setMode(m) {
    d.mpMode = m;
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
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
    slots.forEach((x, i) => { d.texts[i] = x.area.value; });
    const texts = d.texts.slice(0, n);
    last = assembleParts(d.depth, texts, {
      requireComplete: !gen,
      expectedId: gen ? `${topicSlug(d.topic)}_${d.depth}` : null,
    });
    const r = last;
    const res = r.parts;
    const skOk = res[0].ok;
    const valid = (i) => !!texts[i].trim() && res[i].ok;

    modeIntro.textContent = gen
      ? `Copy each prompt into your AI in turn and paste its answer below it. The graph can be visualised after the skeleton; ${dataNames} fill${n === 2 ? 's' : ''} in the explanations.`
      : `Already have all ${word} responses? Paste each one into its box — in any order. The map renders once all ${word} are valid and complete.`;
    single.hidden = gen;

    const shown = new Set();
    slots.forEach((x, i) => {
      x.title.textContent = gen ? x.m.title : x.m.importTitle;
      x.sub.textContent = gen ? x.m.sub : x.m.importSub;
      x.label.textContent = gen ? `Paste the ${x.m.title} response` : x.m.importTitle;
      x.promptWrap.hidden = !gen;
      clear(x.status);
      const p = res[i];
      const has = !!texts[i].trim();
      if (has && p.errors.length) {
        p.errors.forEach((e) => shown.add(e));
        put(x.status, errorNotice(p.errors.slice(0, 15).join('\n') + (p.errors.length > 15 ? `\n… and ${p.errors.length - 15} more` : '')));
      } else if (has) {
        const text = i === 0
          ? `✓ Skeleton: ${p.map.nodes.length} concepts · ${p.map.links.length} links · ${p.map.learningPath.length} learning steps`
          : `✓ ${x.m.label}: ${p.ids.length} concepts enriched` + (skOk ? '' : ' — waiting for the skeleton to cross-check');
        put(x.status, el('div', { class: 'notice notice-ok' }, text));
      }
    });

    if (gen) {
      for (let i = 1; i < n; i++) slots[i].prompt.textContent = skOk ? buildEnrichPrompt(d.topic, d.depth, res[0].map, i, mode.batches) : 'Waiting for the skeleton…';
    }
    const stateOf = (i) => {
      const has = !!texts[i].trim();
      if (has && res[i].errors.length) return 'err';
      if (has && res[i].ok) return 'done';
      return 'active';
    };
    slots.forEach((_, i) => {
      // Generate mode keeps the historical order: each data part unlocks after the previous part.
      const unlocked = !gen || i === 0 || (skOk && slots.slice(1, i).every((__, j) => res[j + 1].ok));
      setState(i, unlocked ? stateOf(i) : 'locked');
    });

    // Progress: how many parts are valid, and which ones are still missing or invalid.
    const done = slots.filter((_, i) => valid(i)).length;
    setProgress(done);
    const pending = meta.filter((_, i) => !valid(i)).map((m) => m.label);
    const ready = r.ok && r.enriched >= r.total;
    partsLine.textContent = ready
      ? `✓ Map ready — all ${n} parts valid`
      : `${done} of ${n} parts valid · ${pending.length ? `still needed: ${pending.join(', ')}` : 'resolve the problems below'}`;
    partsLine.classList.toggle('is-ready', ready);

    // Problems that are not already shown on a slot: cross-part conflicts, missing parts in
    // import mode, missing explanations, and anything from the final whole-map validation.
    clear(assembly);
    const cross = r.errors.filter((e) => !shown.has(e));
    const anyText = texts.some((t) => t.trim());
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
        ? (skOk ? 'Fix the problems above to continue.' : `The graph renders after the skeleton · explanations fill in after ${dataNames}`)
        : `Paste all ${word} parts — Neuron validates each one, then combines them.`;
    } else if (r.enriched >= r.total) {
      launch.textContent = '⬡ Visualise full graph →';
      hint.textContent = `All ${r.total} concepts enriched — full explanations ready`;
    } else if (r.enriched) {
      launch.textContent = `⬡ Visualise (${r.enriched}/${r.total} enriched) →`;
      hint.textContent = `${r.total - r.enriched} of ${r.total} concepts still have no explanation — add the remaining data part, or visualise now and come back via ← Build`;
    } else {
      launch.textContent = '⬡ Visualise skeleton →';
      hint.textContent = `${r.total} concepts loaded, none explained yet — add ${dataNames} for full explanations`;
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

  put(page, head, el('div', { class: ['mp-grid', `mp-grid-${n}`] }, ...slots.map((s) => s.slot)), assembly, partsLine, hint, launch, single);
  refresh();
  return () => timers.forEach(clearTimeout);
}
