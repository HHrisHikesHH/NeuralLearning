// 1200×630 social preview rendered in the owner's browser: title, depth, counts and a
// miniature of the map's actual layout. Used for each published map and for the app's default card.

const W = 1200, H = 630;

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) { line = test; continue; }
    if (line) lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export async function drawOgCard(canvas, { title, depth, concepts, domains, positions = [], colors = [], eyebrow = 'Knowledge map' }) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  try {
    await Promise.all(['800 64px "Exo 2"', '600 28px "Exo 2"', '700 22px "Space Mono"'].map((f) => document.fonts?.load(f)));
  } catch { /* fall back to system fonts */ }

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#03070c');
  bg.addColorStop(1, '#071019');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(860, 300, 20, 860, 300, 520);
  glow.addColorStop(0, 'rgba(0,229,255,0.12)');
  glow.addColorStop(0.5, 'rgba(199,125,255,0.06)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const rnd = seeded([...String(title)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  for (let i = 0; i < 160; i++) {
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H, rnd() * 1.3 + 0.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180,210,255,${0.08 + rnd() * 0.3})`;
    ctx.fill();
  }

  // Constellation: real node positions if given, otherwise a generated cluster.
  let pts = positions.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 6) {
    const palette = colors.length ? colors : ['#4fc3f7', '#c77dff', '#69f0ae', '#ffb74d', '#f48fb1'];
    pts = Array.from({ length: 70 }, (_, i) => {
      const a = rnd() * Math.PI * 2, r = 30 + rnd() * 260 * (i % 5 === 0 ? 0.5 : 1);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.75, color: palette[i % palette.length], type: i % 9 === 0 ? 'category' : 'concept' };
    });
    pts.unshift({ x: 0, y: 0, color: '#cceeff', type: 'root' });
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const box = { x: 640, y: 60, w: 520, h: 510 };
  const sc = Math.min(box.w / (x1 - x0 || 1), box.h / (y1 - y0 || 1));
  const map = (p) => ({ x: box.x + (p.x - x0) * sc + (box.w - (x1 - x0) * sc) / 2, y: box.y + (p.y - y0) * sc + (box.h - (y1 - y0) * sc) / 2 });
  const placed = pts.map((p) => ({ ...p, ...map(p) }));
  const root = placed.find((p) => p.type === 'root') || placed[0];
  ctx.lineWidth = 1;
  for (const p of placed) {
    if (p === root) continue;
    const near = p.type === 'category' ? root : placed.filter((q) => q.type === 'category').sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] || root;
    ctx.strokeStyle = `${p.color || '#4fc3f7'}33`;
    ctx.beginPath(); ctx.moveTo(near.x, near.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  for (const p of placed) {
    const r = p.type === 'root' ? 16 : p.type === 'category' ? 9 : p.hot ? 5 : 3.5;
    ctx.shadowColor = p.color || '#4fc3f7';
    ctx.shadowBlur = p.type === 'concept' ? 8 : 18;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `${p.color || '#4fc3f7'}${p.type === 'concept' ? 'cc' : '33'}`;
    ctx.fill();
    if (p.type !== 'concept') { ctx.strokeStyle = p.color || '#cceeff'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  ctx.shadowBlur = 0;

  // Text
  const brand = ctx.createLinearGradient(72, 0, 300, 0);
  brand.addColorStop(0, '#00e5ff'); brand.addColorStop(0.55, '#c77dff'); brand.addColorStop(1, '#69f0ae');
  ctx.fillStyle = brand;
  ctx.font = '800 34px "Exo 2", system-ui, sans-serif';
  ctx.fillText('⬡ NEURON', 72, 104);

  ctx.fillStyle = '#7f9db0';
  ctx.font = '700 20px "Space Mono", ui-monospace, monospace';
  ctx.fillText(eyebrow.toUpperCase(), 72, 190);

  ctx.fillStyle = '#e6f2f8';
  let size = 62;
  ctx.font = `800 ${size}px "Exo 2", system-ui, sans-serif`;
  let lines = wrapLines(ctx, title, 540, 3);
  if (lines.length > 2) {
    size = 50;
    ctx.font = `800 ${size}px "Exo 2", system-ui, sans-serif`;
    lines = wrapLines(ctx, title, 540, 3);
  }
  const lh = Math.round(size * 1.16);
  lines.forEach((l, i) => ctx.fillText(l, 72, 250 + i * lh));

  const metaY = 250 + (lines.length - 1) * lh + 36;
  ctx.font = '700 20px "Space Mono", ui-monospace, monospace';
  let x = 72;
  for (const chip of [String(depth || '').toUpperCase(), concepts ? `${concepts} CONCEPTS` : '', domains ? `${domains} DOMAINS` : ''].filter(Boolean)) {
    const w = ctx.measureText(chip).width + 32;
    ctx.strokeStyle = chip === String(depth).toUpperCase() ? 'rgba(0,229,255,0.6)' : 'rgba(255,255,255,0.22)';
    ctx.fillStyle = chip === String(depth).toUpperCase() ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, metaY, w, 44, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = chip === String(depth).toUpperCase() ? '#00e5ff' : '#a8c3d1';
    ctx.fillText(chip, x + 16, metaY + 29);
    x += w + 14;
  }

  ctx.fillStyle = '#7f9db0';
  ctx.font = '600 24px "Exo 2", system-ui, sans-serif';
  ctx.fillText('Interactive knowledge graph · explore concepts and a learning path', 72, 566);
  return canvas;
}

/** Render a preview and return it as base64 for upload (PNG, or JPEG if the PNG is large). */
export async function renderOgImage(data) {
  const canvas = await drawOgCard(document.createElement('canvas'), data);
  const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
  let blob = await toBlob('image/png');
  let ext = 'png';
  if (!blob || blob.size > 600_000) { blob = await toBlob('image/jpeg', 0.88); ext = 'jpg'; }
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), ext, mime: ext === 'png' ? 'image/png' : 'image/jpeg', size: bytes.length };
}
