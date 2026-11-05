// Small UI primitives for the owner app: dialogs, toasts, downloads and error wording.

import { el, clear, put } from '../core/dom.js';
import { GitHubError } from './github.js';
import { CryptoError } from './crypto.js';

let toastHost;
export function toast(message, kind = 'info', ms = 4200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const t = el('div', { class: ['toast', kind === 'ok' && 'toast-ok', kind === 'err' && 'toast-err'] }, message);
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function explain(e) {
  if (e instanceof GitHubError || e instanceof CryptoError) return e.message;
  if (e?.name === 'AbortError') return 'Cancelled.';
  return 'Something went wrong. Please try again.';
}

/**
 * Open a modal dialog. `build(close)` returns the body nodes; resolve with close(value).
 * Escape / backdrop resolve with `undefined`.
 */
export function dialog({ title, build, label = title, wide = false, dismissable = true }) {
  return new Promise((resolve) => {
    const d = el('dialog', { class: ['dlg', wide && 'dlg-wide'], 'aria-label': label });
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      d.close();
      d.remove();
      resolve(value);
    };
    const body = el('div', { class: 'dlg-body' }, title ? el('h2', { class: 'dlg-title' }, title) : null, ...[build(close)].flat());
    d.appendChild(body);
    d.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissable) close(undefined); });
    d.addEventListener('click', (e) => { if (dismissable && e.target === d) close(undefined); });
    document.body.appendChild(d);
    d.showModal();
    (d.querySelector('[autofocus]') || d.querySelector('input, textarea, select, button'))?.focus();
  });
}

export function confirmDialog({ title, text, confirmLabel = 'Confirm', danger = false, extra = null }) {
  return dialog({
    title,
    build: (close) => [
      ...[].concat(text).filter(Boolean).map((t) => el('p', { class: 'dlg-text' }, t)),
      extra,
      el('div', { class: 'dlg-actions' },
        el('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => close(false) } }, 'Cancel'),
        el('button', { class: ['btn', danger ? 'btn-danger' : 'btn-primary'], type: 'button', autofocus: !danger, on: { click: () => close(true) } }, confirmLabel)),
    ],
  }).then((v) => v === true);
}

export function promptDialog({ title, label, value = '', confirmLabel = 'Save', maxlength = 160, type = 'text', hint = '' }) {
  return dialog({
    title,
    build: (close) => {
      const input = el('input', { class: 'input', type, maxlength: String(maxlength), autofocus: true, autocomplete: type === 'password' ? 'current-password' : 'off' });
      input.value = value;
      const form = el('form', { class: 'dlg-form', on: { submit: (e) => { e.preventDefault(); close(input.value); } } },
        el('label', { class: 'field' }, el('span', {}, label), input, hint ? el('small', {}, hint) : null),
        el('div', { class: 'dlg-actions' },
          el('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => close(undefined) } }, 'Cancel'),
          el('button', { class: 'btn btn-primary', type: 'submit' }, confirmLabel)));
      requestAnimationFrame(() => { input.focus(); input.select(); });
      return form;
    },
  });
}

/** Run `task` while showing a non-dismissable progress dialog. */
export async function withProgress(title, task) {
  let setText;
  let finish;
  const shown = dialog({
    title, dismissable: false,
    build: (close) => {
      finish = close;
      const line = el('p', { class: 'dlg-text' }, 'Working…');
      setText = (t) => { line.textContent = t; };
      return el('div', { class: 'progress-row', role: 'status', 'aria-live': 'polite' }, el('span', { class: 'spinner' }), line);
    },
  });
  try {
    return await task((t) => setText(t));
  } finally {
    finish();
    await shown;
  }
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename, class: 'sr-only' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileText(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, class: 'sr-only' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      if (f.size > 60_000_000) { toast('That file is too large.', 'err'); return resolve(null); }
      resolve(await f.text());
    });
    document.body.appendChild(input);
    input.click();
  });
}

export const slug = (s) => String(s || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'map';

export function setBusy(btn, busy, label) {
  if (busy) {
    btn.dataset.idle = btn.textContent;
    btn.disabled = true;
    put(clear(btn), el('span', { class: 'spinner' }), label || 'Working…');
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.idle || btn.textContent;
  }
}
