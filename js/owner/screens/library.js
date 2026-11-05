// My Maps: the owner's encrypted library.

import { el, clear, formatDate, displayTitle, put } from '../../core/dom.js';
import { toNCF } from '../../core/ncf.js';
import { promptDialog, confirmDialog, toast, explain, download, slug, withProgress } from '../ui.js';
import { openShareDialog } from './share.js';

const SORTS = {
  updated: { label: 'Recently updated', fn: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) },
  created: { label: 'Recently created', fn: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) },
  title: { label: 'Title A–Z', fn: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) },
  topic: { label: 'Topic A–Z', fn: (a, b) => a.topic.localeCompare(b.topic, undefined, { sensitivity: 'base' }) },
};
const PREF = 'neuron.library.sort';
const getPref = () => { try { return localStorage.getItem(PREF); } catch { return null; } };
const setPref = (v) => { try { localStorage.setItem(PREF, v); } catch { /* ignore */ } };

export function renderLibrary(root, { app, navigate }) {
  const { vault, shares } = app.session;
  let sort = SORTS[getPref()] ? getPref() : 'updated';
  let query = '';
  let destroyed = false;

  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search by title or topic…', 'aria-label': 'Search maps', autocomplete: 'off' });
  const sel = el('select', { class: 'select', 'aria-label': 'Sort maps' }, ...Object.entries(SORTS).map(([k, v]) => el('option', { value: k }, v.label)));
  sel.value = sort;
  const count = el('p', { class: 'muted', 'aria-live': 'polite' });
  const list = el('ul', { class: 'lib-grid', 'aria-label': 'Saved maps' });
  const status = el('div');
  const draftBanner = el('div');

  put(root, el('div', { class: 'page' },
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'My maps'),
      el('a', { class: 'btn btn-primary', href: '#/new' }, '+ New map')),
    draftBanner,
    el('div', { class: 'lib-tools' }, search, sel),
    count, status, list));

  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
  sel.addEventListener('change', () => { sort = sel.value; setPref(sort); render(); });

  function renderDraftBanner() {
    clear(draftBanner);
    const d = app.draft;
    if (!d?.map || !d.dirty || d.savedId) return;
    put(draftBanner, el('div', { class: 'notice notice-warn row' },
      el('span', { class: 'spacer' }, `You have an unsaved map: “${displayTitle(d.map.topic)}”.`),
      el('a', { class: 'btn btn-sm', href: '#/draft' }, 'Open'),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: async () => { if (await confirmDialog({ title: 'Discard unsaved map?', text: 'This cannot be undone.', confirmLabel: 'Discard', danger: true })) { app.draft = null; renderDraftBanner(); } } } }, 'Discard')));
  }

  function card(m) {
    const pct = m.steps ? Math.round(((m.progress?.length || 0) / Math.max(1, Math.min(m.steps, m.nodes))) * 100) : 0;
    const shareBadge = m.share?.status === 'published' ? el('span', { class: 'badge badge-green' }, 'SHARED')
      : m.share ? el('span', { class: 'badge' }, m.share.status === 'unpublishing' ? 'UNPUBLISHING…' : 'PUBLISHING…') : null;
    return el('li', { class: 'map-card' },
      el('a', { class: 'map-card-title', href: `#/map/${m.id}` }, displayTitle(m.title)),
      el('div', { class: 'map-card-meta' },
        el('span', { class: 'badge badge-accent' }, String(m.depth).toUpperCase()), shareBadge,
        m.title.toLowerCase() !== m.topic.toLowerCase() ? el('span', {}, displayTitle(m.topic)) : null),
      el('div', { class: 'map-card-meta' }, `${m.nodes} concepts · ${m.links} links · ${m.steps} steps`),
      m.steps ? el('div', { class: 'stack', style: { gap: '4px' } },
        el('div', { class: 'map-card-meta' }, `Learning path ${Math.min(100, pct)}%`),
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('div', { class: 'bar-fill', style: { width: `${Math.min(100, pct)}%` } }))) : null,
      el('div', { class: 'map-card-meta' }, `Updated ${formatDate(m.updatedAt)} · Created ${formatDate(m.createdAt)}`),
      el('div', { class: 'map-card-actions' },
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => rename(m) } }, 'Rename'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => share(m) } }, m.share?.status === 'published' ? 'Sharing' : 'Share'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => exportJson(m) } }, 'Export'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': `Delete ${m.title}`, on: { click: () => remove(m) } }, 'Delete')));
  }

  function render() {
    renderDraftBanner();
    const all = vault.list();
    const shown = all.filter((m) => !query || m.title.toLowerCase().includes(query) || m.topic.toLowerCase().includes(query)).sort(SORTS[sort].fn);
    clear(list);
    if (!all.length) {
      count.textContent = '';
      list.hidden = true;
      put(clear(status), el('div', { class: 'card empty' },
        el('div', { class: 'empty-mark', 'aria-hidden': 'true' }, '⬡'),
        el('h2', { class: 'card-title' }, 'No saved maps yet'),
        el('p', { class: 'muted' }, 'Create a map, explore it, then save it here. Saved maps are encrypted and available on any device you unlock.'),
        el('a', { class: 'btn btn-primary', href: '#/new' }, 'Create your first map')));
      return;
    }
    clear(status);
    list.hidden = false;
    count.textContent = query ? `${shown.length} of ${all.length} maps` : `${all.length} map${all.length === 1 ? '' : 's'}`;
    if (!shown.length) put(status, el('p', { class: 'muted' }, 'No maps match your search.'));
    put(list, ...shown.map(card));
  }

  async function rename(m) {
    const v = await promptDialog({ title: 'Rename map', label: 'Map title', value: m.title });
    if (v === undefined) return;
    try { await vault.renameMap(m.id, v); toast('Renamed.', 'ok'); } catch (e) { toast(explain(e), 'err'); }
    render();
  }

  async function share(m) {
    let cached;
    await openShareDialog(app, m.id, async () => (cached ||= await vault.readMap(m.id)));
    render();
  }

  async function exportJson(m) {
    try {
      const map = await withProgress('Preparing export', (step) => { step('Decrypting map…'); return vault.readMap(m.id); });
      download(`${slug(m.title)}.neuron.json`, JSON.stringify(toNCF(map), null, 2));
    } catch (e) { toast(explain(e), 'err'); }
  }

  async function remove(m) {
    const shared = m.share?.status === 'published';
    const also = el('input', { type: 'checkbox', id: 'also-unpublish', checked: true });
    const ok = await confirmDialog({
      title: `Delete “${m.title}”?`,
      text: ['The map will be removed from your library on every device.', 'An encrypted copy remains in your private vault’s git history, so it can be recovered manually (see README).'],
      extra: shared ? el('label', { class: 'check', for: 'also-unpublish' }, also, el('span', {}, 'Also unpublish its public link')) : null,
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    try {
      await withProgress('Deleting map', async (step) => {
        if (shared && also.checked) { step('Unpublishing the public link…'); await shares.unpublish(vault.entry(m.id)); }
        step('Removing from your vault…');
        await vault.deleteMap(m.id);
      });
      if (app.draft?.savedId === m.id) app.draft = null;
      toast('Deleted.', 'ok');
    } catch (e) { toast(explain(e), 'err', 7000); }
    render();
  }

  render();
  if (!vault.list().length) {
    list.hidden = true;
    put(clear(status), ...Array.from({ length: 3 }, () => el('div', { class: 'skeleton', 'aria-hidden': 'true' })), el('p', { class: 'sr-only', role: 'status' }, 'Loading maps…'));
  }
  vault.refresh().then(() => { if (!destroyed) render(); }).catch((e) => {
    if (destroyed) return;
    put(clear(status), el('div', { class: 'notice notice-err', role: 'alert' }, explain(e)),
      el('button', { class: 'btn btn-sm', type: 'button', on: { click: () => { clear(root); renderLibrary(root, { app, navigate }); } } }, 'Retry'));
  });
  return () => { destroyed = true; };
}
