// The interactive map screen shared by the owner app and the public viewer.
// mode 'owner' adds learning-path completion (reported through onProgress);
// mode 'viewer' is strictly read-only and never reports anything outward.

import { el, clear, prefersReducedMotion, isMobileViewport, displayTitle, put } from '../core/dom.js';
import { createGraph } from './engine.js';

const DEPTH_LEVEL = { 1: 'Foundational', 2: 'Intermediate', 3: 'Advanced · frontier' };
const humanize = (s) => String(s || '').replace(/_/g, ' ');
const minutes = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);

function proseNodes(text) {
  const paras = String(text || '').trim().split(/\n\s*\n/).map((p) => p.replace(/^[ \t]+/gm, '').trim()).filter(Boolean);
  return paras.map((p) => el('p', {}, p));
}

export function mountMapView(host, map, opts = {}) {
  const owner = opts.mode === 'owner';
  const onProgress = opts.onProgress || (() => {});
  const progress = new Set(owner ? opts.progress || [] : []);
  const reduced = prefersReducedMotion();

  const catMap = new Map(map.categories.map((c) => [c.id, c]));
  const nodeMap = new Map(map.nodes.map((n) => [n.id, n]));
  const path = [...map.learningPath].sort((a, b) => a.order - b.order);
  const pathIds = [...new Set(path.map((s) => s.nodeId))];
  const stepOf = new Map();
  path.forEach((s, i) => { if (!stepOf.has(s.nodeId)) stepOf.set(s.nodeId, { ...s, index: i }); });
  const dependents = new Map();
  map.nodes.forEach((n) => n.prerequisites.forEach((p) => {
    if (!dependents.has(p)) dependents.set(p, []);
    dependents.get(p).push(n.id);
  }));
  const linksOf = new Map();
  map.links.forEach((l) => {
    for (const [self, other, dir] of [[l.source, l.target, 'out'], [l.target, l.source, 'in']]) {
      if (!linksOf.has(self)) linksOf.set(self, []);
      linksOf.get(self).push({ other, dir, relation: l.relation, label: l.label });
    }
  });

  const state = { tab: 'concept', open: !isMobileViewport() && opts.inspectorOpen !== false, selected: null, walk: -1 };

  // ── Skeleton ──
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('class', 'mv-svg');
  svgEl.setAttribute('role', 'img');
  svgEl.setAttribute('aria-label', `Knowledge graph of ${map.topic}: ${map.nodes.length} concepts. Use search, the domain list or the learning path to navigate.`);

  const searchInput = el('input', {
    type: 'search', class: 'mv-search-input', placeholder: 'Search concepts…',
    'aria-label': 'Search concepts', autocomplete: 'off', spellcheck: 'false',
  });
  const searchHits = el('span', { class: 'mv-search-hits', 'aria-live': 'polite' });

  const header = el('header', { class: 'mv-top' },
    opts.left || null,
    el('div', { class: 'mv-title' },
      el('h1', { class: 'mv-topic', title: opts.title || map.topic }, displayTitle(opts.title || map.topic)),
      el('span', { class: 'badge' }, map.depth.toUpperCase())),
    el('div', { class: 'mv-stats' }, `${map.nodes.length} concepts · ${map.links.length} connections`),
    el('div', { class: 'mv-search' }, el('span', { class: 'mv-search-icon', 'aria-hidden': 'true' }, '⌕'), searchInput, searchHits),
    opts.actions?.length ? el('div', { class: 'mv-actions' }, ...opts.actions) : null,
  );

  const zoomCtl = el('div', { class: 'mv-zoom', role: 'group', 'aria-label': 'Zoom' },
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', on: { click: () => graph.zoomIn() } }, '+'),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', on: { click: () => graph.zoomOut() } }, '−'),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fit map to screen', title: 'Fit', on: { click: () => graph.fit() } }, '⊡'));

  const legendList = el('ul', { class: 'mv-legend-list' });
  const legendToggle = el('button', {
    class: 'mv-legend-toggle', type: 'button', 'aria-expanded': 'false',
    on: { click: () => setLegendOpen(legendToggle.getAttribute('aria-expanded') !== 'true') },
  }, 'Domains');
  const legend = el('nav', { class: 'mv-legend', 'aria-label': 'Domains' }, legendToggle, legendList);
  let activeCat = null;
  map.categories.forEach((cat) => {
    const btn = el('button', {
      class: 'mv-legend-item', type: 'button', 'aria-pressed': 'false', style: { '--c': cat.color },
      on: {
        click: () => {
          if (activeCat === cat.id) { activeCat = null; graph.clearFocus(); }
          else { activeCat = cat.id; graph.highlightCategory(cat.id); }
          for (const b of legendList.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn && activeCat === cat.id));
        },
      },
    }, el('span', { class: 'dot', 'aria-hidden': 'true' }), cat.icon ? el('span', { class: 'ico', 'aria-hidden': 'true' }, cat.icon) : null, el('span', { class: 'txt' }, cat.label));
    legendList.appendChild(el('li', {}, btn));
  });
  function setLegendOpen(open) {
    legendToggle.setAttribute('aria-expanded', String(open));
    legend.classList.toggle('is-collapsed', !open);
  }
  setLegendOpen(window.matchMedia?.('(min-width: 1280px)').matches ?? true);

  // Inspector
  const tabs = {};
  const panels = {};
  const tablist = el('div', { class: 'insp-tabs', role: 'tablist', 'aria-label': 'Map details' });
  const TABS = [['concept', 'Concept'], ['path', 'Learning path'], ['insights', 'Insights']];
  TABS.forEach(([id, label]) => {
    tabs[id] = el('button', {
      class: 'insp-tab', type: 'button', role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`,
      on: { click: () => setTab(id, true), keydown: onTabKey },
    }, label);
    panels[id] = el('section', { class: 'insp-panel', role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}`, tabindex: '0' });
    tablist.appendChild(tabs[id]);
  });
  const collapseBtn = el('button', {
    class: 'icon-btn insp-collapse', type: 'button', 'aria-label': 'Hide details panel',
    on: { click: () => setOpen(!state.open) },
  }, '›');
  const inspector = el('aside', { class: 'mv-inspector', 'aria-label': 'Map details' },
    el('div', { class: 'insp-head' }, el('span', { class: 'insp-grip', 'aria-hidden': 'true' }), tablist, collapseBtn),
    el('div', { class: 'insp-body' }, ...Object.values(panels)));

  const tip = el('div', { class: 'mv-tip', role: 'tooltip', 'aria-hidden': 'true' });

  const footProgress = el('div', { class: 'mv-foot-progress' });
  const footer = el('footer', { class: 'mv-foot' }, owner && pathIds.length ? footProgress : el('span'),
    el('span', { class: 'mv-hint' }, isMobileViewport()
      ? 'Pinch to zoom · drag to pan · tap a concept'
      : 'Drag to pan · scroll to zoom · hover to preview · click to focus · / to search'));

  const root = el('div', { class: ['mv', owner ? 'mv-owner' : 'mv-viewer'] }, svgEl, header, zoomCtl, legend, inspector, tip, footer);
  clear(host).appendChild(root);

  // ── Graph ──
  const graph = createGraph(svgEl, map, {
    reducedMotion: reduced,
    rootLabel: displayTitle(map.topic),
    insets: () => {
      const mobile = isMobileViewport();
      const top = header.offsetHeight + 12;
      const right = !mobile && state.open ? inspector.offsetWidth + 24 : 24;
      const bottom = mobile ? root.clientHeight - inspector.getBoundingClientRect().top + 12 : footer.offsetHeight + 16;
      const legendOpen = !mobile && !legend.classList.contains('is-collapsed');
      return { top, right, bottom: Math.max(48, bottom), left: mobile ? 16 : legendOpen ? legend.offsetWidth + 32 : 72 };
    },
    onHover: (d, e) => (d ? showTip(d, e) : hideTip()),
    onSelect: (d) => select(d, { fly: false }),
    onBackground: () => { state.selected = null; activeCat = null; hideTip(); renderConcept(); markPathActive(null); },
  });

  // ── Tooltip ──
  function showTip(d, e) {
    const cat = catMap.get(d.type === 'category' ? d.id : d.category);
    const prereqs = (d.prerequisites || []).map((p) => nodeMap.get(p)?.label || p);
    put(clear(tip), 
      el('div', { class: 'tip-cat', style: { color: d.color } }, (cat?.label || '').toUpperCase()),
      el('div', { class: 'tip-name', style: { color: d.color } }, d.label),
      el('div', { class: 'tip-desc' }, d.description || 'A key concept in this domain.'),
      d.hot ? el('div', { class: 'chip chip-hot' }, '🔥 Key concept') : null,
      prereqs.length ? el('div', { class: 'tip-pre' }, el('div', { class: 'label' }, 'Prerequisites'),
        el('div', { class: 'chips' }, ...prereqs.map((p) => el('span', { class: 'chip' }, p)))) : null,
      el('div', { class: 'tip-hint' }, 'Click to focus and open details'));
    tip.classList.add('show');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 16, y = e.clientY - 10;
    if (x + w + 12 > innerWidth) x = e.clientX - w - 16;
    if (y + h + 12 > innerHeight) y = innerHeight - h - 12;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  function hideTip() { tip.classList.remove('show'); }

  // ── Selection & concept panel ──
  function chip(id) {
    const n = nodeMap.get(id);
    if (!n) return null;
    return el('button', {
      class: 'chip chip-link', type: 'button', style: { '--c': catMap.get(n.category)?.color || '#888888' },
      on: { click: () => selectById(id) },
    }, n.label);
  }

  function selectById(id, { fly = true } = {}) {
    const d = graph.concept(id);
    if (!d) return;
    graph.focus(id);
    select(d, { fly });
  }

  function select(d, { fly = true } = {}) {
    state.selected = d;
    hideTip();
    renderConcept();
    markPathActive(d.type === 'concept' ? d.id : null);
    setTab('concept');
    setOpen(true);
    if (d.type === 'concept' && (fly || isMobileViewport())) requestAnimationFrame(() => graph.flyTo(d.id));
  }

  function renderConcept() {
    const p = panels.concept;
    clear(p);
    const d = state.selected;
    if (!d) {
      put(p, 
        el('div', { class: 'eyebrow' }, 'About this map'),
        el('h2', { class: 'insp-title' }, displayTitle(opts.title || map.topic)),
        ...proseNodes(map.summary),
        el('p', { class: 'muted' }, 'Select a concept in the graph, search for one, or follow the learning path.'));
      return;
    }
    if (d.type === 'category') {
      const members = map.nodes.filter((n) => n.category === d.id);
      put(p, 
        el('div', { class: 'eyebrow' }, 'Domain'),
        el('h2', { class: 'insp-title', style: { color: d.color } }, `${d.icon ? d.icon + ' ' : ''}${d.label}`),
        d.description ? el('p', { class: 'lead' }, d.description) : null,
        el('h3', { class: 'label' }, `${members.length} concepts`),
        el('div', { class: 'chips' }, ...members.map((n) => chip(n.id))));
      return;
    }
    const n = nodeMap.get(d.id) || d;
    const cat = catMap.get(n.category);
    const step = stepOf.get(n.id);
    const prereqs = n.prerequisites.filter((x) => nodeMap.has(x));
    const leads = (dependents.get(n.id) || []).filter((x) => nodeMap.has(x));
    const rels = linksOf.get(n.id) || [];
    put(p, 
      el('div', { class: 'eyebrow', style: { color: cat?.color } },
        el('span', { class: 'dot', style: { background: cat?.color }, 'aria-hidden': 'true' }), cat?.label || ''),
      el('h2', { class: 'insp-title', style: { color: cat?.color } }, n.label),
      el('div', { class: 'chips meta' },
        el('span', { class: 'chip' }, DEPTH_LEVEL[n.depth_level] || 'Concept'),
        n.hot ? el('span', { class: 'chip chip-hot' }, '🔥 Key concept') : null,
        step ? el('span', { class: 'chip' }, `Step ${step.index + 1} · ${minutes(step.estimatedMinutes)}`) : null),
      n.description ? el('p', { class: 'lead' }, n.description) : null,
      n.analogy ? el('div', { class: 'callout' }, el('div', { class: 'label' }, 'Analogy'), el('p', {}, n.analogy)) : null,
      step?.keyInsight ? el('div', { class: 'callout callout-insight' }, el('div', { class: 'label' }, 'Key insight'), el('p', {}, step.keyInsight)) : null,
      n.additionalInfo
        ? el('div', { class: 'prose' }, ...proseNodes(n.additionalInfo))
        : el('p', { class: 'muted' }, 'No extended explanation for this concept yet.'),
      prereqs.length ? el('div', { class: 'insp-group' }, el('h3', { class: 'label' }, 'Learn first'), el('div', { class: 'chips' }, ...prereqs.map(chip))) : null,
      leads.length ? el('div', { class: 'insp-group' }, el('h3', { class: 'label' }, 'Unlocks'), el('div', { class: 'chips' }, ...leads.map(chip))) : null,
      rels.length ? el('div', { class: 'insp-group' }, el('h3', { class: 'label' }, 'Connections'),
        el('ul', { class: 'rel-list' }, ...rels.slice(0, 24).map((r) => {
          const other = nodeMap.get(r.other);
          if (!other) return null;
          return el('li', {},
            el('span', { class: 'rel' }, r.dir === 'out' ? humanize(r.relation) : `← ${humanize(r.relation)}`),
            el('button', { class: 'link-btn', type: 'button', on: { click: () => selectById(other.id) } }, other.label),
            r.label ? el('span', { class: 'muted' }, ` — ${r.label}`) : null);
        }))) : null,
    );
    p.scrollTop = 0;
  }

  // ── Learning path panel ──
  const stepEls = new Map();
  function renderPath() {
    const p = panels.path;
    clear(p);
    stepEls.clear();
    if (!path.length) { put(p, el('p', { class: 'muted' }, 'This map has no learning path.')); return; }
    const total = path.reduce((s, x) => s + (x.estimatedMinutes || 0), 0);
    const walkPos = el('span', { class: 'walk-pos' });
    const walk = el('div', { class: 'walk', role: 'group', 'aria-label': 'Walk the path' },
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => walkTo(state.walk - 1) } }, '← Prev'),
      walkPos,
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => walkTo(state.walk + 1) } }, 'Next →'));
    put(p, 
      el('p', { class: 'muted' }, `${path.length} steps · about ${minutes(total)} in total.${owner ? ' Tick a step number to mark it done.' : ''}`),
      walk);
    if (owner) put(p, progressBlock());
    let phase = null;
    const list = el('ol', { class: 'lp-list' });
    path.forEach((s, i) => {
      const n = nodeMap.get(s.nodeId);
      if (!n) return;
      if (s.phase && s.phase !== phase) {
        phase = s.phase;
        list.appendChild(el('li', { class: 'lp-phase', 'aria-hidden': 'true' }, phase));
      }
      const color = catMap.get(n.category)?.color || '#888888';
      const num = owner
        ? el('button', {
          class: 'lp-num', type: 'button', 'aria-pressed': String(progress.has(n.id)),
          'aria-label': `Mark “${n.label}” as ${progress.has(n.id) ? 'not done' : 'done'}`,
          on: { click: (e) => { e.stopPropagation(); toggleDone(n.id); } },
        }, String(i + 1))
        : el('span', { class: 'lp-num', 'aria-hidden': 'true' }, String(i + 1));
      const item = el('li', { class: ['lp-step', progress.has(n.id) && 'done'], style: { '--c': color } },
        num,
        el('div', { class: 'lp-body' },
          el('button', { class: 'lp-name', type: 'button', on: { click: () => { state.walk = i; updateWalk(); selectById(n.id); } } }, n.label),
          s.reason ? el('p', { class: 'lp-why' }, s.reason) : null,
          el('div', { class: 'lp-time' }, `~${minutes(s.estimatedMinutes || 10)}`)));
      if (!stepEls.has(n.id)) stepEls.set(n.id, []);
      stepEls.get(n.id).push(item);
      list.appendChild(item);
    });
    put(p, list);
    function updateWalk() { walkPos.textContent = state.walk >= 0 ? `Step ${state.walk + 1} of ${path.length}` : 'Start at step 1'; }
    renderPath.updateWalk = updateWalk;
    updateWalk();
  }

  function walkTo(i) {
    if (!path.length) return;
    state.walk = Math.max(0, Math.min(path.length - 1, i));
    renderPath.updateWalk?.();
    const id = path[state.walk].nodeId;
    selectById(id);
    setTab('path');
    stepEls.get(id)?.[0]?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }

  function markPathActive(id) {
    for (const [nid, els] of stepEls) els.forEach((e) => e.classList.toggle('active', nid === id));
  }

  function progressBlock() {
    const pct = pathIds.length ? Math.round((progress.size / pathIds.length) * 100) : 0;
    return el('div', { class: 'lp-progress' },
      el('div', { class: 'lp-pct' }, `${pct}%`),
      el('div', { class: 'muted' }, `${progress.size} of ${pathIds.length} concepts completed`),
      el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Learning path progress' },
        el('div', { class: 'bar-fill', style: { width: `${pct}%` } })));
  }

  function renderFootProgress() {
    if (!owner || !pathIds.length) return;
    const pct = Math.round((progress.size / pathIds.length) * 100);
    put(clear(footProgress), 
      el('span', { class: 'label' }, 'Learning path'),
      el('div', { class: 'bar bar-sm', 'aria-hidden': 'true' }, el('div', { class: 'bar-fill', style: { width: `${pct}%` } })),
      el('span', { class: 'mv-foot-pct' }, `${pct}%`));
  }

  function toggleDone(id) {
    if (progress.has(id)) progress.delete(id); else progress.add(id);
    const y = panels.path.scrollTop;
    renderPath();
    markPathActive(state.selected?.type === 'concept' ? state.selected.id : null);
    panels.path.scrollTop = y;
    renderFootProgress();
    onProgress([...progress]);
  }

  // ── Insights panel ──
  function renderInsights() {
    const p = panels.insights;
    clear(p);
    const m = map.metadata;
    const group = (title, items, cls) => (items.length
      ? el('div', { class: 'insp-group' }, el('h3', { class: 'label' }, title), el('ul', { class: cls }, ...items.map((t) => el('li', {}, t))))
      : null);
    const central = m.centralNode && nodeMap.get(m.centralNode);
    const parts = [
      central ? el('div', { class: 'insp-group' }, el('h3', { class: 'label' }, 'Central concept'), el('div', { class: 'chips' }, chip(central.id))) : null,
      group('Cross-domain insights', m.crossDomainInsights, 'insight-list'),
      group('Common misconceptions', m.commonMisconceptions, 'insight-list warn'),
      m.suggestedNextTopics.length ? el('div', { class: 'insp-group' }, el('h3', { class: 'label' }, 'Explore next'),
        el('div', { class: 'chips' }, ...m.suggestedNextTopics.map((t) => el('span', { class: 'chip' }, t)))) : null,
    ].filter(Boolean);
    put(p, ...(parts.length ? parts : [el('p', { class: 'muted' }, 'This map has no extra insights.')]));
  }

  // ── Tabs / open state ──
  function setTab(id, focus = false) {
    state.tab = id;
    for (const [tid] of TABS) {
      const on = tid === id;
      tabs[tid].setAttribute('aria-selected', String(on));
      tabs[tid].tabIndex = on ? 0 : -1;
      panels[tid].hidden = !on;
    }
    if (focus) { setOpen(true); tabs[id].focus(); }
  }
  function onTabKey(e) {
    const ids = TABS.map((t) => t[0]);
    const i = ids.indexOf(state.tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setTab(ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length], true);
    }
  }
  function setOpen(open) {
    state.open = open;
    root.classList.toggle('insp-open', open);
    collapseBtn.setAttribute('aria-label', open ? 'Hide details panel' : 'Show details panel');
    collapseBtn.textContent = isMobileViewport() ? (open ? '⌄' : '⌃') : (open ? '›' : '‹');
  }

  // ── Search & keyboard ──
  let searchTimer;
  let lastHits = [];
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      lastHits = graph.search(searchInput.value);
      searchHits.textContent = searchInput.value.trim() ? `${lastHits.length} found` : '';
    }, 120);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && lastHits.length) {
      const h = lastHits[0];
      if (h.type === 'concept') selectById(h.id);
      else { graph.focusCategory(h.id); select(h, { fly: false }); }
    }
  });
  function onKey(e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === '/' && !typing) { e.preventDefault(); searchInput.focus(); }
    else if (e.key === 'Escape') {
      if (searchInput.value) { searchInput.value = ''; graph.search(''); searchHits.textContent = ''; }
      else if (state.selected) { state.selected = null; graph.clearFocus(); renderConcept(); markPathActive(null); }
      else if (isMobileViewport() && state.open) setOpen(false);
    }
  }
  document.addEventListener('keydown', onKey);

  renderConcept();
  renderPath();
  renderInsights();
  renderFootProgress();
  setTab('concept');
  setOpen(state.open);

  return {
    graph,
    root,
    progress: () => [...progress],
    nodePositions: () => graph.nodePositions(),
    destroy() {
      clearTimeout(searchTimer);
      document.removeEventListener('keydown', onKey);
      graph.destroy();
      clear(host);
    },
  };
}
