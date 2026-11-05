// Explicit publishing UI. Nothing is ever published without this dialog and its consent checkbox.

import { el, clear, copyText, flashButton, put } from '../../core/dom.js';
import { sharePageUrl } from '../../config.js';
import { dialog, confirmDialog, explain, toast } from '../ui.js';

function linkBox(url) {
  const input = el('input', { class: 'input', readonly: true, 'aria-label': 'Public link' });
  input.value = url;
  input.addEventListener('focus', () => input.select());
  const copy = el('button', { class: 'btn btn-primary', type: 'button' }, 'Copy link');
  copy.addEventListener('click', async () => flashButton(copy, (await copyText(url)) ? '✓ Copied' : 'Copy failed'));
  const actions = [copy, el('a', { class: 'btn btn-ghost', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open ↗')];
  if (navigator.share) {
    actions.push(el('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => navigator.share({ url }).catch(() => {}) } }, 'Share…'));
  }
  return el('div', { class: 'stack' }, el('div', { class: 'share-link' }, input), el('div', { class: 'row' }, ...actions));
}

/**
 * @param app      owner app state (session.vault, session.shares, session.sharesPrivate)
 * @param entryId  vault map id
 * @param getMap   async () => map model to publish
 * @param getPositions () => node positions for the preview image (optional)
 */
export function openShareDialog(app, entryId, getMap, getPositions = () => []) {
  const { vault, shares, sharesPrivate } = app.session;

  return dialog({
    title: 'Share this map',
    wide: true,
    build: (close) => {
      const body = el('div', { class: 'stack' });

      function render() {
        clear(body);
        const entry = vault.entry(entryId);
        if (!entry) { put(body, el('p', { class: 'dlg-text' }, 'This map is no longer in your library.')); return; }
        const share = entry.share;
        if (share?.status === 'published') {
          const stale = share.stale || (share.updatedAt && entry.updatedAt > share.updatedAt);
          put(body, 
            el('p', { class: 'dlg-text' }, 'Anyone with this link can view a read-only copy of the map. They cannot see your library or change anything.'),
            linkBox(sharePageUrl(share.id)),
            stale ? el('div', { class: 'notice notice-warn' }, 'Your map has changed since it was published. Update the public copy to share the latest version.') : null,
            el('div', { class: 'dlg-actions' },
              el('button', { class: 'btn btn-danger', type: 'button', on: { click: unpublish } }, 'Unpublish'),
              el('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => publish(true) } }, 'Update public copy'),
              el('button', { class: 'btn btn-primary', type: 'button', on: { click: () => close(true) } }, 'Done')));
          return;
        }
        const consent = el('input', { type: 'checkbox', id: 'share-consent' });
        const go = el('button', { class: 'btn btn-primary', type: 'button', disabled: true, on: { click: () => publish(false) } }, 'Publish publicly');
        consent.addEventListener('change', () => { go.disabled = !consent.checked; });
        put(body, 
          el('p', { class: 'dlg-text' }, 'Publishing creates a separate, public, read-only copy of this map with its own link. Your library, your other maps and your progress stay private and encrypted.'),
          el('ul', { class: 'steps-list' },
            el('li', { class: 'todo' }, 'Anyone with the link can view, copy and download the published copy.'),
            el('li', { class: 'todo' }, 'Unpublishing removes the page, but cannot recall copies already made, and the snapshot stays in the shares repository’s git history.'),
            el('li', { class: 'todo' }, sharesPrivate
              ? 'Your shares repository is private, so the link is unlisted: only people you give it to can find it.'
              : 'Your shares repository is public, so anyone browsing it on GitHub can see every published map.')),
          el('label', { class: 'check', for: 'share-consent' }, consent, el('span', {}, 'I understand this map will be public.')),
          el('div', { class: 'dlg-actions' },
            el('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => close(false) } }, 'Cancel'), go));
      }

      async function publish(update) {
        const steps = ['Recording the share in your vault', 'Uploading the public snapshot', 'Waiting for GitHub Pages to go live'];
        const items = steps.map((s) => el('li', { class: 'todo' }, s));
        const wait = el('p', { class: 'muted', 'aria-live': 'polite' });
        put(clear(body), el('div', { class: 'progress-row', role: 'status' }, el('span', { class: 'spinner' }), el('span', {}, update ? 'Updating public copy…' : 'Publishing…')), el('ul', { class: 'steps-list' }, ...items), wait);
        const mark = (i) => items.forEach((li, j) => { li.className = j < i ? 'done' : j === i ? 'active' : 'todo'; });
        try {
          mark(0);
          const map = await getMap();
          const entry = vault.entry(entryId);
          mark(1);
          const r = await shares.publish(entry, map, { title: entry.title, positions: getPositions() });
          mark(2);
          const live = await shares.waitUntilLive(r.id, r.updatedAt, { onTick: (s) => { wait.textContent = `${s}s — GitHub Pages usually takes under a minute.`; } });
          mark(3);
          if (!live) toast('Published. GitHub Pages is still deploying — the link will work in a few minutes.');
          else toast('Your map is live.', 'ok');
          render();
        } catch (e) {
          put(clear(body), el('div', { class: 'notice notice-err', role: 'alert' }, explain(e)),
            el('p', { class: 'muted' }, 'Nothing was half-published that you need to clean up; Neuron will finish or roll back the share next time you unlock.'),
            el('div', { class: 'dlg-actions' }, el('button', { class: 'btn btn-ghost', type: 'button', on: { click: render } }, 'Back')));
        }
      }

      async function unpublish() {
        const entry = vault.entry(entryId);
        const ok = await confirmDialog({
          title: 'Unpublish this map?',
          text: ['The public link will stop working once GitHub Pages redeploys (usually within a minute).', 'People who already opened or downloaded it may still have a copy, and the snapshot remains in the shares repository’s git history.'],
          confirmLabel: 'Unpublish', danger: true,
        });
        if (!ok) return;
        put(clear(body), el('div', { class: 'progress-row', role: 'status' }, el('span', { class: 'spinner' }), el('span', {}, 'Unpublishing…')));
        try {
          await shares.unpublish(entry);
          toast('Unpublished.', 'ok');
        } catch (e) {
          toast(explain(e), 'err');
        }
        render();
      }

      render();
      return body;
    },
  });
}
