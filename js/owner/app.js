// Owner app: hash router, shell header, session lifecycle.

import { CONFIG } from '../config.js';
import { el, clear, prefersReducedMotion, put } from '../core/dom.js';
import { startStars } from '../core/stars.js';
import { idleTimer } from './session.js';
import { toast, explain } from './ui.js';
import { renderUnlock } from './screens/unlock.js';
import { renderLibrary } from './screens/library.js';
import { renderNew, renderBuild } from './screens/create.js';
import { renderMap } from './screens/mapscreen.js';
import { openSettings } from './screens/settings.js';

const viewEl = document.getElementById('view');
const shell = document.getElementById('shell');
let cleanup = null;
let stopIdle = null;
let firstRoute = true;

const app = {
  session: null,
  draft: null,
  returnTo: null,
  lockNotice: null,
  navigate,
  lock(reason = 'Locked.') {
    stopIdle?.();
    stopIdle = null;
    app.session = null;
    if (app.draft && !(app.draft.dirty && !app.draft.savedId)) app.draft = null;
    app.lockNotice = reason;
    navigate('#/');
  },
  refreshView: () => route(),
};

function navigate(hash) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) route();
  else location.hash = hash;
}

function onUnlocked(session) {
  app.session = session;
  stopIdle = idleTimer(CONFIG.idleLockMinutes, () => app.lock(`Locked after ${CONFIG.idleLockMinutes} minutes without activity.`));
  session.shares.reconcile(session.vault.list()).catch((e) => toast(`Could not check shared links: ${explain(e)}`, 'err'));
  const to = app.returnTo && app.returnTo !== '#/' ? app.returnTo : '#/maps';
  app.returnTo = null;
  toast('Vault unlocked.', 'ok');
  navigate(to);
}

function renderShell(visible) {
  shell.hidden = !visible;
  if (!visible) return;
  put(clear(shell), 
    el('a', { class: 'brand', href: '#/maps', 'aria-label': 'Neuron — my maps' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '⬡'), 'Neuron'),
    el('nav', { class: 'shell-nav', 'aria-label': 'Main' },
      el('span', { class: 'lock-state', title: 'Vault unlocked' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', { class: 'btn-label' }, 'Unlocked')),
      el('a', { class: 'btn btn-ghost btn-sm', href: '#/maps' }, 'My maps'),
      el('a', { class: 'btn btn-sm', href: '#/new' }, '+', el('span', { class: 'btn-label' }, ' New map')),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Settings', on: { click: () => openSettings(app) } }, '⚙', el('span', { class: 'btn-label' }, ' Settings')),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Lock vault', on: { click: () => app.lock('Locked.') } }, '🔒', el('span', { class: 'btn-label' }, ' Lock'))));
}

function route() {
  const [, name = '', arg = ''] = (location.hash || '#/').match(/^#\/([a-z]*)\/?(.*)$/) || [];
  cleanup?.();
  cleanup = null;
  clear(viewEl);
  if (!app.session && name) {
    app.returnTo = location.hash;
    history.replaceState(null, '', '#/');
    return route();
  }
  const ctx = { app, navigate };
  let title = 'Neuron — Knowledge Graph Builder';
  const fullScreen = name === 'draft' || name === 'map';
  renderShell(!!app.session && !fullScreen);

  if (!app.session) {
    renderUnlock(viewEl, { app, onUnlocked });
  } else if (name === '' || name === 'maps') {
    if (name === '') history.replaceState(null, '', '#/maps');
    title = 'My maps · Neuron';
    cleanup = renderLibrary(viewEl, ctx);
  } else if (name === 'new') {
    title = 'New map · Neuron';
    renderNew(viewEl, ctx);
  } else if (name === 'build') {
    if (!app.draft) return navigate('#/new');
    title = 'Build map · Neuron';
    cleanup = renderBuild(viewEl, ctx);
  } else if (name === 'draft') {
    if (!app.draft?.map) return navigate('#/new');
    title = `${app.draft.map.topic} · Neuron`;
    cleanup = renderMap(viewEl, ctx);
  } else if (name === 'map') {
    const entry = app.session.vault.entry(arg);
    title = `${entry?.title || 'Map'} · Neuron`;
    cleanup = renderMap(viewEl, { ...ctx, id: arg });
  } else {
    return navigate('#/maps');
  }
  document.title = title;
  if (!firstRoute) viewEl.focus({ preventScroll: true });
  firstRoute = false;
}

window.addEventListener('beforeunload', (e) => {
  if (app.draft?.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// GitHub Pages cannot send frame-blocking headers, so refuse to run inside a frame (clickjacking).
if (window.top !== window.self) {
  clear(viewEl).append(el('div', { class: 'page page-narrow' },
    el('h1', { class: 'page-title' }, 'Neuron cannot run inside a frame'),
    el('a', { class: 'btn btn-primary', href: location.href, target: '_top', rel: 'noopener' }, 'Open Neuron directly')));
} else {
  startStars(document.getElementById('stars'), { reduced: prefersReducedMotion() });
  window.addEventListener('hashchange', route);
  route();
}
