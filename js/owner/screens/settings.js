// Settings: backup / restore, passphrase change, device token, lock.

import { el, formatDate } from '../../core/dom.js';
import { CONFIG } from '../../config.js';
import { passphraseProblem, unlockWithPassphrase, CryptoError } from '../crypto.js';
import { device, changePassphrase } from '../session.js';
import { dialog, toast, explain, download, readFileText, promptDialog, withProgress, confirmDialog } from '../ui.js';

export function openSettings(app) {
  const s = app.session;
  return dialog({
    title: 'Settings',
    wide: true,
    build: (close) => {
      const remembered = !!device.get();
      return [
        el('section', { class: 'settings-section' },
          el('h3', { class: 'label' }, 'Storage'),
          el('dl', { class: 'kv' },
            el('dt', {}, 'Vault'), el('dd', {}, `${CONFIG.owner}/${CONFIG.vaultRepo} · ${s.vaultPrivate ? 'private' : 'PUBLIC (still encrypted)'}`),
            el('dt', {}, 'Shares'), el('dd', {}, `${CONFIG.owner}/${CONFIG.sharesRepo} · ${s.sharesPrivate ? 'private repo, unlisted links' : 'public repo, listable'}`),
            el('dt', {}, 'Maps'), el('dd', {}, String(s.vault.list().length)),
            el('dt', {}, 'Auto-lock'), el('dd', {}, `after ${CONFIG.idleLockMinutes} minutes without activity`))),
        el('section', { class: 'settings-section' },
          el('h3', { class: 'label' }, 'Backup'),
          el('p', { class: 'help' }, 'An encrypted backup contains every map. It is unreadable without your passphrase or recovery code, so it is safe to keep anywhere.'),
          el('div', { class: 'row' },
            el('button', { class: 'btn', type: 'button', on: { click: exportBackup } }, 'Download encrypted backup'),
            el('button', { class: 'btn btn-ghost', type: 'button', on: { click: importBackup } }, 'Import a backup…'))),
        el('section', { class: 'settings-section' },
          el('h3', { class: 'label' }, 'Security'),
          el('div', { class: 'row' },
            el('button', { class: 'btn btn-ghost', type: 'button', on: { click: passphrase } }, 'Change passphrase'),
            remembered ? el('button', { class: 'btn btn-ghost', type: 'button', on: { click: forget } }, 'Forget token on this device') : null,
            el('button', { class: 'btn btn-danger', type: 'button', on: { click: () => { close(); app.lock('Locked.'); } } }, 'Lock now')),
          el('p', { class: 'help' }, remembered
            ? 'This device stores your GitHub token encrypted with your passphrase.'
            : 'This device does not store your token; you will paste it again next time.')),
        el('div', { class: 'dlg-actions' }, el('button', { class: 'btn btn-primary', type: 'button', on: { click: () => close() } }, 'Done')),
      ];

      async function exportBackup() {
        try {
          const b = await withProgress('Creating backup', (step) => { step('Reading encrypted files…'); return s.vault.exportBackup(); });
          download(`neuron-vault-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b));
          toast('Backup downloaded.', 'ok');
        } catch (e) { toast(explain(e), 'err'); }
      }

      async function importBackup() {
        const text = await readFileText();
        if (!text) return;
        let backup;
        try { backup = JSON.parse(text); } catch { backup = null; }
        if (!backup || backup.neuron !== 'backup') return toast('That is not a Neuron vault backup.', 'err');
        try {
          let summary;
          try {
            summary = await withProgress('Importing backup', () => s.vault.importBackup(backup));
          } catch (e) {
            if (!(e instanceof CryptoError) || !backup.keyring) throw e;
            const pass = await promptDialog({ title: 'Backup passphrase', label: `Passphrase for the backup from ${formatDate(backup.exportedAt)}`, type: 'password', confirmLabel: 'Import', hint: 'This backup was made with a different vault key.' });
            if (pass === undefined) return;
            const key = await unlockWithPassphrase(backup.keyring, pass);
            summary = await withProgress('Importing backup', () => s.vault.importBackup(backup, key));
          }
          toast(`Imported: ${summary.added} added, ${summary.updated} updated, ${summary.skipped} unchanged.`, 'ok', 7000);
          app.refreshView();
        } catch (e) { toast(e.code === 'wrong_secret' ? 'Wrong passphrase for that backup.' : explain(e), 'err'); }
      }

      async function passphrase() {
        const current = await promptDialog({ title: 'Change passphrase', label: 'Current passphrase', type: 'password', confirmLabel: 'Next' });
        if (!current) return;
        const next = await promptDialog({ title: 'Change passphrase', label: 'New passphrase', type: 'password', confirmLabel: 'Next', hint: '16+ characters or 4+ random words.' });
        if (!next) return;
        const problem = passphraseProblem(next);
        if (problem) return toast(problem, 'err', 8000);
        const again = await promptDialog({ title: 'Change passphrase', label: 'Repeat the new passphrase', type: 'password', confirmLabel: 'Change passphrase' });
        if (again !== next) return toast('The passphrases did not match. Nothing changed.', 'err');
        try {
          await withProgress('Changing passphrase', (step) => { step('Re-encrypting your vault key…'); return changePassphrase(s, { current, next }); });
          toast('Passphrase changed. Your recovery code still works.', 'ok', 7000);
        } catch (e) { toast(e.code === 'wrong_secret' ? 'The current passphrase was wrong. Nothing changed.' : explain(e), 'err'); }
      }

      async function forget() {
        if (!(await confirmDialog({ title: 'Forget token on this device?', text: 'You will need to paste your GitHub token next time you unlock here.', confirmLabel: 'Forget', danger: true }))) return;
        device.forget();
        toast('Token removed from this device.', 'ok');
        close();
      }
    },
  });
}
