// D3 force-graph engine. Ported from the original buildGraph(): same hierarchy
// (root → categories → concepts + data links), forces, glow and pulse visuals.
// Expects the sanitised model from core/ncf.js and the global `d3` (v7).

const KEY = { root: 'r:', category: 'c:', concept: 'n:' };
const keyOf = (l) => (typeof l === 'object' ? l.key : l);

export function createGraph(svgEl, data, opts = {}) {
  const {
    onHover = () => {},
    onSelect = () => {},
    onBackground = () => {},
    insets = () => ({ top: 72, right: 24, bottom: 64, left: 24 }),
    reducedMotion = false,
    rootLabel = data.topic,
  } = opts;
  const d3 = window.d3;
  const dur = (ms) => (reducedMotion ? 0 : ms);
  const timers = new Set();
  let userMoved = false;
  let destroyed = false;

  const W = () => svgEl.clientWidth || innerWidth;
  const H = () => svgEl.clientHeight || innerHeight;

  const catColor = Object.fromEntries(data.categories.map((c) => [c.id, c.color]));
  const catIndex = Object.fromEntries(data.categories.map((c, i) => [c.id, i]));

  const rootNode = { key: KEY.root, id: null, label: data.topic, type: 'root', color: '#cceeff' };
  const catNodes = data.categories.map((c) => ({ ...c, key: KEY.category + c.id, type: 'category' }));
  const conceptNodes = data.nodes.map((n) => ({
    ...n, key: KEY.concept + n.id, type: 'concept', color: catColor[n.category] || '#aaaaaa',
  }));
  const allNodes = [rootNode, ...catNodes, ...conceptNodes];
  const byKey = new Map(allNodes.map((n) => [n.key, n]));

  const allLinks = [
    ...data.categories.map((c) => ({ source: KEY.root, target: KEY.category + c.id, kind: 'h' })),
    ...data.nodes.map((n) => ({ source: KEY.category + n.category, target: KEY.concept + n.id, kind: 'h' })),
    ...data.links.map((l) => ({
      ...l, source: KEY.concept + l.source, target: KEY.concept + l.target,
      kind: l.type === 'hierarchical' ? 'h' : 'x',
    })),
  ];

  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  const defs = svg.append('defs');

  data.categories.forEach((c, i) => {
    const f = defs.append('filter').attr('id', `gf${i}`)
      .attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
    f.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'blur');
    const m = f.append('feMerge');
    m.append('feMergeNode').attr('in', 'blur');
    m.append('feMergeNode').attr('in', 'SourceGraphic');
  });
  const rf = defs.append('filter').attr('id', 'gfroot')
    .attr('x', '-100%').attr('y', '-100%').attr('width', '300%').attr('height', '300%');
  rf.append('feGaussianBlur').attr('stdDeviation', '12').attr('result', 'blur');
  const rm = rf.append('feMerge');
  rm.append('feMergeNode').attr('in', 'blur');
  rm.append('feMergeNode').attr('in', 'SourceGraphic');

  const gSel = svg.append('g');
  const lG = gSel.append('g');
  const nG = gSel.append('g');
  let k = 1;

  const zoomBehavior = d3.zoom().scaleExtent([0.08, 4]).extent(() => [[0, 0], [W(), H()]]).on('zoom', (e) => {
    gSel.attr('transform', e.transform);
    if (e.sourceEvent) userMoved = true;
    if (e.transform.k !== k) { k = e.transform.k; scheduleLabels(); }
  });
  svg.call(zoomBehavior).on('dblclick.zoom', null);

  const simulation = d3.forceSimulation(allNodes)
    .force('link', d3.forceLink(allLinks).id((d) => d.key)
      .distance((d) => (d.kind === 'x' ? 180 : d.source.type === 'root' ? 220 : 80))
      .strength((d) => (d.kind === 'x' ? 0.01 : d.source.type === 'root' ? 0.25 : 0.5)))
    .force('charge', d3.forceManyBody().strength((d) => (d.type === 'root' ? -2800 : d.type === 'category' ? -600 : -120)))
    .force('center', d3.forceCenter(W() / 2, H() / 2).strength(0.05))
    .force('collide', d3.forceCollide().radius((d) => (d.type === 'root' ? 60 : d.type === 'category' ? 50 : 35)));

  const LE = lG.selectAll('line').data(allLinks).join('line')
    .attr('class', (d) => `link${d.kind === 'x' ? ' cross' : ''}`)
    .attr('stroke', (d) => byKey.get(keyOf(d.target))?.color || '#888888');

  const NE = nG.selectAll('g.node').data(allNodes).join('g')
    .attr('class', (d) => `node node-${d.type}`)
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

  if (!reducedMotion) {
    NE.filter((d) => d.hot).append('circle')
      .attr('fill', 'none').attr('stroke', (d) => d.color)
      .attr('stroke-width', 0.7).attr('r', 8).attr('opacity', 0)
      .each(function () {
        const el = d3.select(this);
        const pulse = () => {
          if (destroyed) return;
          el.attr('r', 8).attr('opacity', 0.55)
            .transition().duration(2200).attr('r', 28).attr('opacity', 0).on('end', pulse);
        };
        const t = setTimeout(() => { timers.delete(t); pulse(); }, Math.random() * 4000);
        timers.add(t);
      });
  }

  NE.append('circle')
    .attr('r', (d) => (d.type === 'root' ? 30 : d.type === 'category' ? 17 : 7))
    .attr('fill', (d) => (d.type === 'root' ? 'rgba(200,240,255,0.06)' : d.color + '14'))
    .attr('stroke', (d) => d.color)
    .attr('stroke-width', (d) => (d.type === 'root' ? 2 : d.type === 'category' ? 1.5 : 1))
    .attr('filter', (d) => {
      if (d.type === 'root') return 'url(#gfroot)';
      const ci = catIndex[d.type === 'category' ? d.id : d.category];
      return ci != null ? `url(#gf${ci})` : null;
    });

  NE.filter((d) => d.type === 'concept').append('circle')
    .attr('r', 2.2).attr('fill', (d) => d.color).attr('opacity', 0.85);

  NE.filter((d) => d.type === 'category').append('text')
    .attr('class', 'icon').attr('text-anchor', 'middle').attr('dy', '0.35em')
    .attr('font-size', '11px').text((d) => d.icon || '○');

  const labels = NE.append('text')
    .attr('class', (d) => `lbl lbl-${d.type}${d.hot ? ' hot' : ''}`)
    .attr('text-anchor', 'middle')
    .attr('fill', (d) => (d.type === 'root' ? '#e6f2f8' : d.color))
    .text((d) => {
      if (d.type === 'category') return d.label.toUpperCase();
      if (d.type === 'root') return rootLabel.length > 28 ? rootLabel.slice(0, 26) + '…' : rootLabel;
      return d.label;
    });

  // Labels keep a constant on-screen size; visibility depends on zoom level (see graph.css).
  const SCREEN_PX = { root: 15, category: 12, concept: 12 };
  let labelFrame = 0;
  function updateLabels() {
    labelFrame = 0;
    const inv = 1 / k;
    labels
      .attr('font-size', (d) => SCREEN_PX[d.type] * inv)
      .attr('stroke-width', 3.5 * inv)
      .attr('y', (d) => (d.type === 'concept' ? -(7 + 5 * inv)
        : d.type === 'category' ? 17 + 16 * inv
          : 30 + 20 * inv));
    svgEl.classList.toggle('z-far', k < 0.45);
    svgEl.classList.toggle('z-mid', k >= 0.45 && k < 0.85);
  }
  function scheduleLabels() { if (!labelFrame) labelFrame = requestAnimationFrame(updateLabels); }
  updateLabels();

  // Warm up off-screen so the first frame is already spread out and can be fitted immediately.
  simulation.stop();
  simulation.tick(80);
  simulation.on('tick', () => {
    LE.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    NE.attr('transform', (d) => `translate(${d.x},${d.y})`);
  });
  let settledFit = false;
  simulation.on('end', () => {
    if (settledFit || userMoved || destroyed) return;
    settledFit = true;
    fit(true, 1);
  });

  const publicNode = (d) => (d.type === 'root' ? null : d);

  NE.on('pointerover', (e, d) => { if (e.pointerType === 'mouse' && d.type !== 'root') onHover(d, e); })
    .on('pointermove', (e, d) => { if (e.pointerType === 'mouse' && d.type !== 'root') onHover(d, e); })
    .on('pointerout', (e) => { if (e.pointerType === 'mouse') onHover(null, e); })
    .on('click', (e, d) => {
      e.stopPropagation();
      if (d.type === 'root') return;
      focusKey(d.key);
      onSelect(publicNode(d));
    });
  svg.on('click', () => { clearFocus(); onBackground(); });

  // ── Highlighting ──
  function setForcedLabels(keys) {
    labels.classed('force', (d) => keys.has(d.key));
  }

  function focusKey(key) {
    const d = byKey.get(key);
    if (!d) return;
    const conn = new Set([key]);
    allLinks.forEach((l) => {
      const s = keyOf(l.source), t = keyOf(l.target);
      if (s === key) conn.add(t);
      if (t === key) conn.add(s);
    });
    if (d.type === 'category') conceptNodes.filter((c) => c.category === d.id).forEach((c) => conn.add(c.key));
    NE.classed('dim', (n) => !conn.has(n.key)).classed('hi', (n) => n.key === key);
    LE.classed('hi', (l) => keyOf(l.source) === key || keyOf(l.target) === key)
      .classed('dim', (l) => !(keyOf(l.source) === key || keyOf(l.target) === key));
    setForcedLabels(conn);
  }

  function clearFocus() {
    NE.classed('dim', false).classed('hi', false);
    LE.classed('hi', false).classed('dim', false);
    setForcedLabels(new Set());
  }

  function highlightCategory(catId) {
    const members = new Set([KEY.root, KEY.category + catId]);
    conceptNodes.filter((c) => c.category === catId).forEach((c) => members.add(c.key));
    NE.classed('dim', (n) => !members.has(n.key)).classed('hi', (n) => members.has(n.key) && n.type !== 'root');
    LE.classed('dim', (l) => !(members.has(keyOf(l.source)) || members.has(keyOf(l.target)))).classed('hi', false);
    setForcedLabels(members);
  }

  function search(q) {
    q = q.toLowerCase().trim();
    if (!q) { clearFocus(); return []; }
    const hits = new Set();
    allNodes.forEach((n) => { if (n.type !== 'root' && n.label.toLowerCase().includes(q)) hits.add(n.key); });
    const nearby = new Set(hits);
    allLinks.forEach((l) => {
      const s = keyOf(l.source), t = keyOf(l.target);
      if (hits.has(s)) nearby.add(t);
      if (hits.has(t)) nearby.add(s);
    });
    NE.classed('dim', (n) => !nearby.has(n.key)).classed('hi', (n) => hits.has(n.key));
    LE.classed('hi', (l) => hits.has(keyOf(l.source)) || hits.has(keyOf(l.target)))
      .classed('dim', (l) => !nearby.has(keyOf(l.source)) && !nearby.has(keyOf(l.target)));
    setForcedLabels(hits);
    return [...hits].map((h) => byKey.get(h));
  }

  // ── Camera ──
  function fit(animate = true, maxScale = 1.4) {
    const ins = insets();
    const pts = allNodes.filter((n) => n.x != null);
    if (!pts.length) return;
    const pad = 40;
    const x0 = Math.min(...pts.map((n) => n.x)) - pad, x1 = Math.max(...pts.map((n) => n.x)) + pad;
    const y0 = Math.min(...pts.map((n) => n.y)) - pad, y1 = Math.max(...pts.map((n) => n.y)) + pad;
    const aw = Math.max(120, W() - ins.left - ins.right), ah = Math.max(120, H() - ins.top - ins.bottom);
    const scale = Math.max(0.12, Math.min(maxScale, Math.min(aw / (x1 - x0), ah / (y1 - y0))));
    const cx = ins.left + aw / 2, cy = ins.top + ah / 2;
    const t = d3.zoomIdentity.translate(cx, cy).scale(scale).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    (animate ? svg.transition().duration(dur(700)) : svg).call(zoomBehavior.transform, t);
  }

  function flyTo(conceptId, scale = 1.4) {
    const n = byKey.get(KEY.concept + conceptId);
    if (!n || n.x == null) return;
    const ins = insets();
    const cx = ins.left + (W() - ins.left - ins.right) / 2, cy = ins.top + (H() - ins.top - ins.bottom) / 2;
    svg.transition().duration(dur(700)).ease(d3.easeCubicInOut)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(cx - n.x * scale, cy - n.y * scale).scale(scale));
  }

  const zoomBy = (f) => svg.transition().duration(dur(250)).call(zoomBehavior.scaleBy, f);

  LE.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
    .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
  NE.attr('transform', (d) => `translate(${d.x},${d.y})`);
  fit(false, 1);
  simulation.restart();
  const fitTimer = setTimeout(() => { timers.delete(fitTimer); if (!userMoved) fit(true, 1); }, 1500);
  timers.add(fitTimer);

  const onResize = () => {
    simulation.force('center', d3.forceCenter(W() / 2, H() / 2).strength(0.05));
    simulation.alpha(0.1).restart();
  };
  window.addEventListener('resize', onResize);

  return {
    focus: (conceptId) => focusKey(KEY.concept + conceptId),
    focusCategory: (catId) => focusKey(KEY.category + catId),
    clearFocus,
    highlightCategory,
    search,
    fit,
    flyTo,
    zoomIn: () => zoomBy(1.35),
    zoomOut: () => zoomBy(0.74),
    concept: (id) => byKey.get(KEY.concept + id) || null,
    nodePositions: () => allNodes.filter((n) => n.x != null).map((n) => ({ x: n.x, y: n.y, color: n.color, type: n.type, hot: !!n.hot })),
    destroy() {
      destroyed = true;
      simulation.stop();
      timers.forEach(clearTimeout);
      if (labelFrame) cancelAnimationFrame(labelFrame);
      window.removeEventListener('resize', onResize);
      svg.selectAll('*').interrupt();
      svg.on('.zoom', null).on('click', null);
      svg.selectAll('*').remove();
    },
  };
}
