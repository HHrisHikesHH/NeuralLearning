// Owner map screen: the shared map view plus save, rename, share, export and progress sync.

import { el, displayTitle, put } from '../../core/dom.js';
import { toNCF } from '../../core/ncf.js';
import { mountMapView } from '../../graph/mapview.js';
import { dialog, promptDialog, toast, explain, download, slug, setBusy } from '../ui.js';
import { openShareDialog } from './share.js';

function loading(root, text) {
  put(root, el('div', { class: 'page page-narrow' }, el('div', { class: 'card' }, el('div', { class: 'progress-row', role: 'status' }, el('span', { class: 'spinner' }), text))));
}

export function renderMap(root, { app, navigate, id }) {
  let view = null;
  let destroyed = false;
  let progressTimer = 0;
  let pendingProgress = null;

  const isDraft = !id;
  const d = app.draft;

  async function start() {
    let map, title, progress;
    if (isDraft) {
      if (!d?.map) return navigate('#/new');
      map = d.map;
      title = d.title || d.map.topic;
      progress = d.progress;
    } else {
      const entry = app.session.vault.entry(id);
      if (!entry) {
        put(root, el('div', { class: 'page page-narrow' }, el('div', { class: 'card' }, el('h1', { class: 'page-title' }, 'Map not found'), el('p', { class: 'muted' }, 'It may have been deleted on another device.'), el('a', { class: 'btn', href: '#/maps' }, '← My maps'))));
        return;
      }
      if (d?.savedId === id && d.map) map = d.map;
      else {
        loading(root, 'Decrypting map…');
        try { map = await app.session.vault.readMap(id); } catch (e) {
          if (destroyed) return;
          root.replaceChildren(el('div', { class: 'page page-narrow' }, el('div', { class: 'card' }, el('div', { class: 'notice notice-err', role: 'alert' }, explain(e)), el('div', { class: 'row' }, el('a', { class: 'btn', href: '#/maps' }, '← My maps'), el('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => { root.replaceChildren(); start(); } } }, 'Retry')))));
          return;
        }
        if (destroyed) return;
        root.replaceChildren();
      }
      title = entry.title;
      progress = entry.progress || [];
    }
    mount(map, title, progress);
  }

  function savedId() { return isDraft ? d.savedId : id; }

  function mount(map, title, progress) {
    const state = el('span', { class: 'save-state', 'aria-live': 'polite' });
    const saveBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: save } }, 'Save');
    const shareBtn = el('button', { class: 'btn btn-sm', type: 'button', on: { click: share } }, 'Share');
    const more = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-haspopup': 'dialog', on: { click: moreMenu } }, '⋯', el('span', { class: 'sr-only' }, 'More actions'));
    const backTarget = isDraft && d.multi && !d.savedId ? '#/build' : '#/maps';
    const back = el('a', { class: 'btn btn-ghost btn-sm', href: backTarget }, backTarget === '#/build' ? '← Build' : '← My maps');

    function refreshState() {
      const sid = savedId();
      const dirty = isDraft && d.dirty;
      saveBtn.hidden = !!sid && !dirty;
      saveBtn.textContent = sid ? 'Save changes' : 'Save';
      state.textContent = dirty ? 'Unsaved' : sid ? 'Saved' : '';
      state.classList.toggle('dirty', dirty);
      const entry = sid && app.session.vault.entry(sid);
      shareBtn.textContent = entry?.share?.status === 'published' ? 'Shared ✓' : 'Share';
    }

    view = mountMapView(root, map, {
      mode: 'owner', title, progress, left: back, actions: [state, saveBtn, shareBtn, more],
      onProgress: (done) => {
        if (isDraft && !d.savedId) { d.progress = done; return; }
        if (isDraft) d.progress = done;
        pendingProgress = done;
        clearTimeout(progressTimer);
        progressTimer = setTimeout(flushProgress, 2500);
      },
    });
    refreshState();

    async function save() {
      let t = title;
      if (!savedId()) {
        const v = await promptDialog({ title: 'Save to My Maps', label: 'Map title', value: displayTitle(map.topic), confirmLabel: 'Save', hint: 'Saved maps are encrypted before they leave this browser.' });
        if (v === undefined) return;
        t = v;
      }
      setBusy(saveBtn, true, 'Saving…');
      try {
        const newId = await app.session.vault.saveMap({ id: savedId(), title: t, map });
        if (d && isDraft) {
          if (d.progress.length) await app.session.vault.setProgress(newId, d.progress);
          Object.assign(d, { savedId: newId, dirty: false, title: app.session.vault.entry(newId)?.title || t });
        }
        title = app.session.vault.entry(newId)?.title || t;
        toast('Saved to My Maps.', 'ok');
        if (isDraft) history.replaceState(null, '', `#/map/${newId}`);
      } catch (e) {
        toast(explain(e), 'err', 7000);
      } finally {
        setBusy(saveBtn, false);
        refreshState();
      }
    }

    async function share() {
      if (!savedId()) {
        toast('Save the map first — then you can publish it.');
        await save();
        if (!savedId()) return;
      }
      if (isDraft && d.dirty) await save();
      await openShareDialog(app, savedId(), async () => map, () => view?.nodePositions() || []);
      refreshState();
    }

    function moreMenu() {
      dialog({
        title: 'Map actions',
        build: (close) => el('div', { class: 'stack' },
          savedId() ? el('button', { class: 'btn btn-block', type: 'button', on: { click: async () => { close(); await rename(); } } }, 'Rename') : null,
          el('button', { class: 'btn btn-block', type: 'button', on: { click: () => { close(); download(`${slug(title)}.neuron.json`, JSON.stringify(toNCF(map), null, 2)); } } }, 'Download JSON (NCF)'),
          isDraft && d.multi ? el('a', { class: 'btn btn-block', href: '#/build', on: { click: () => close() } }, 'Add enrichment batches') : null,
          el('button', { class: 'btn btn-ghost btn-block', type: 'button', on: { click: () => close() } }, 'Close')),
      });
    }

    async function rename() {
      const v = await promptDialog({ title: 'Rename map', label: 'Map title', value: title });
      if (v === undefined) return;
      try {
        await app.session.vault.renameMap(savedId(), v);
        title = app.session.vault.entry(savedId()).title;
        if (d && isDraft) d.title = title;
        root.querySelector('.mv-topic').textContent = displayTitle(title);
        toast('Renamed.', 'ok');
      } catch (e) { toast(explain(e), 'err'); }
    }
  }

  async function flushProgress() {
    if (!pendingProgress || !savedId()) return;
    const done = pendingProgress;
    pendingProgress = null;
    try { await app.session?.vault.setProgress(savedId(), done); } catch (e) {
      pendingProgress = pendingProgress || done;
      toast(`Progress not saved: ${explain(e)}`, 'err');
    }
  }

  start();
  return () => {
    destroyed = true;
    clearTimeout(progressTimer);
    if (pendingProgress && app.session) flushProgress();
    view?.destroy();
  };
}
