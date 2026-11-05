// Public, read-only viewer. This bundle deliberately imports no vault, crypto, GitHub,
// prompt or save code: a viewer can only see the one snapshot it fetches.

import { appBaseUrl, shareMapUrl } from '../config.js';
import { loadMapFromObject, LIMITS } from '../core/ncf.js';
import { isId } from '../core/b64.js';
import { el, clear, prefersReducedMotion, displayTitle } from '../core/dom.js';
import { startStars } from '../core/stars.js';
import { mountMapView } from '../graph/mapview.js';

const app = document.getElementById('app');
const minutes = (m) => (m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`);

function screen(...children) {
  clear(app).appendChild(el('main', { class: 'vw-screen' }, el('div', { class: 'vw-card' }, ...children)));
}

function brand() {
  return el('a', { class: 'vw-brand', href: appBaseUrl(), rel: 'noopener', 'aria-label': 'Neuron home' },
    el('span', { class: 'vw-mark', 'aria-hidden': 'true' }, '⬡'), el('span', {}, 'Neuron'));
}

function showLoading() {
  screen(brand(), el('div', { class: 'vw-loading', role: 'status' }, el('span', { class: 'spinner' }), 'Loading knowledge map…'));
}

function showError(title, detail) {
  document.title = `${title} · Neuron`;
  screen(brand(), el('h1', { class: 'vw-title' }, title), el('p', { class: 'dlg-text' }, detail),
    el('a', { class: 'btn btn-ghost', href: appBaseUrl() }, 'About Neuron'));
}

function snapshotUrl() {
  if (document.documentElement.dataset.share === 'page') return new URL('map.json', location.href).href;
  const id = new URLSearchParams(location.search).get('s');
  return isId(id) ? shareMapUrl(id) : null;
}

async function fetchSnapshot(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache', credentials: 'omit', redirect: 'error' });
  } catch {
    return { error: ['Could not load this map', navigator.onLine === false ? 'You appear to be offline. Reconnect and refresh the page.' : 'The network request failed. Please try again in a moment.'] };
  }
  if (res.status === 404) return { error: ['Map not found', 'This link may have been unpublished by its owner, or it was copied incorrectly.'] };
  if (!res.ok) return { error: ['Could not load this map', `The server responded with ${res.status}. Please try again later.`] };
  const text = await res.text();
  if (text.length > LIMITS.textBytes) return { error: ['Map data invalid', 'This map is larger than Neuron can display.'] };
  let env;
  try { env = JSON.parse(text); } catch { return { error: ['Map data invalid', 'The published file is not valid JSON.'] }; }
  if (!env || env.neuronShare !== 1 || typeof env.map !== 'object') return { error: ['Map data invalid', 'This is not a Neuron shared map.'] };
  const r = loadMapFromObject(env.map);
  if (!r.ok) return { error: ['Map data invalid', 'The published map failed validation and cannot be shown safely.'] };
  const title = typeof env.title === 'string' && env.title.trim() ? env.title.trim().slice(0, 160) : r.data.topic;
  return { map: r.data, title, publishedAt: env.publishedAt };
}

function intro(map, title, onStart, onPath) {
  const total = map.learningPath.reduce((s, x) => s + (x.estimatedMinutes || 0), 0);
  const startBtn = el('button', { class: 'btn btn-primary', type: 'button', on: { click: onStart } }, 'Start exploring');
  const card = el('div', { class: 'vw-intro', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vw-intro-title' },
    el('div', { class: 'vw-intro-card' },
      el('div', { class: 'eyebrow' }, 'Shared knowledge map'),
      el('h2', { class: 'vw-title', id: 'vw-intro-title' }, displayTitle(title)),
      el('div', { class: 'chips' },
        el('span', { class: 'badge badge-accent' }, map.depth.toUpperCase()),
        el('span', { class: 'chip' }, `${map.nodes.length} concepts`),
        el('span', { class: 'chip' }, `${map.categories.length} domains`),
        map.learningPath.length ? el('span', { class: 'chip' }, `~${minutes(total)} path`) : null),
      el('div', { class: 'prose vw-summary' }, ...String(map.summary).split(/\n\s*\n/).map((p) => el('p', {}, p.trim()))),
      el('div', { class: 'vw-intro-actions' }, startBtn,
        map.learningPath.length ? el('button', { class: 'btn btn-ghost', type: 'button', on: { click: onPath } }, 'Follow the learning path') : null),
      el('p', { class: 'vw-note' }, 'Read-only view. Zoom, search and explore freely — nothing you do here changes the map.')));
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') onStart(); });
  requestAnimationFrame(() => startBtn.focus());
  return card;
}

async function boot() {
  startStars(document.getElementById('stars'), { reduced: prefersReducedMotion() });
  const url = snapshotUrl();
  if (!url) return showError('Link incomplete', 'This shared-map link is missing its identifier. Ask the owner for the full link.');
  showLoading();
  const r = await fetchSnapshot(url);
  if (r.error) return showError(...r.error);

  document.title = `${r.title} · Neuron knowledge map`;
  const infoBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'About this map' }, 'ⓘ About');
  clear(app);
  const host = el('div', { class: 'vw-host' });
  app.appendChild(host);
  const view = mountMapView(host, r.map, { mode: 'viewer', title: r.title, left: brand(), actions: [infoBtn], inspectorOpen: false });

  let overlay;
  const close = () => { overlay?.remove(); overlay = null; infoBtn.focus(); };
  const open = () => {
    if (overlay) return;
    overlay = intro(r.map, r.title, close, () => {
      close();
      view.root.querySelector('#tab-path')?.click();
    });
    app.appendChild(overlay);
  };
  infoBtn.addEventListener('click', open);
  open();
}

boot();
