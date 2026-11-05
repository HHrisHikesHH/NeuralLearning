// Home for signed-out visitors and the owner's unlock / first-time setup / recovery flows.

import { el, clear, copyText, flashButton, put } from '../../core/dom.js';
import { CONFIG } from '../../config.js';
import { passphraseProblem, CryptoError } from '../crypto.js';
import { device, unlock, setup, restore, recover } from '../session.js';
import { explain, download, readFileText, setBusy } from '../ui.js';

const TOKEN_RE = /^(github_pat_|ghp_)[A-Za-z0-9_]{20,250}$/;

function field(label, input, hint) {
  return el('label', { class: 'field' }, el('span', {}, label), input, hint ? el('small', {}, hint) : null);
}

function passInput(autocomplete, id) {
  return el('input', { class: 'input', type: 'password', autocomplete, id, spellcheck: 'false', required: true });
}

function tokenHelp() {
  return el('details', { class: 'help' },
    el('summary', {}, 'How to create the token'),
    el('ol', {},
      el('li', {}, 'GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.'),
      el('li', {}, 'Expiration: 90 days is a good balance.'),
      el('li', {}, ['Repository access: Only select repositories → ', el('code', {}, CONFIG.vaultRepo), ' and ', el('code', {}, CONFIG.sharesRepo), '.']),
      el('li', {}, ['Permissions: ', el('code', {}, 'Contents: Read and write'), '. Nothing else.']),
      el('li', {}, ['Do not give it access to ', el('code', {}, CONFIG.appRepo), '.'])));
}

export function renderUnlock(root, { app, onUnlocked }) {
  const card = el('section', { class: 'card auth-card', 'aria-labelledby': 'auth-title' });
  put(root, el('div', { class: 'hero' },
    el('div', {},
      el('h1', { class: 'hero-logo' }, '⬡ NEURON'),
      el('p', { class: 'hero-tag' }, 'Semantic knowledge graph builder')),
    el('p', { class: 'hero-lede' }, 'Neuron turns any topic into a living knowledge graph — concepts at the right distance from each other, the connections between them, and a learning path through it all.'),
    card,
    el('p', { class: 'visitor-note' }, 'Received a link to a shared map? Just open that link — no sign-in is needed to view shared maps.')));

  const status = () => el('div', { 'aria-live': 'polite' });

  function signIn({ useToken = !device.get(), notice = null } = {}) {
    clear(card);
    const remembered = !useToken;
    const token = el('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', id: 'gh-token', placeholder: 'github_pat_…' });
    const pass = passInput('current-password', 'vault-pass');
    const remember = el('input', { type: 'checkbox', id: 'remember', checked: true });
    const msg = status();
    const submit = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Unlock');
    const form = el('form', { class: 'stack', on: { submit: go } },
      remembered ? el('p', { class: 'help' }, 'This device remembers your GitHub token (encrypted). Enter your vault passphrase to unlock.') : field('GitHub token', token, 'Kept in memory only, unless you choose to remember it below.'),
      field('Vault passphrase', pass),
      remembered ? null : el('label', { class: 'check', for: 'remember' }, remember, el('span', {}, 'Remember the token on this device, encrypted with my passphrase')),
      msg, submit,
      remembered ? null : tokenHelp(),
      el('div', { class: 'row' },
        remembered || device.get()
          ? el('button', { class: 'link-btn', type: 'button', on: { click: () => signIn({ useToken: !useToken }) } }, remembered ? 'Use a different token' : 'Use the saved token')
          : null,
        el('span', { class: 'spacer' }),
        el('button', { class: 'link-btn', type: 'button', on: { click: recovery } }, 'Forgot passphrase?')));
    put(card, el('h2', { class: 'card-title', id: 'auth-title' }, '🔐 Owner sign-in'), notice, form);
    (remembered ? pass : token).focus();

    async function go(e) {
      e.preventDefault();
      clear(msg);
      const tok = token.value.trim();
      if (!remembered && !TOKEN_RE.test(tok)) { put(msg, el('div', { class: 'notice notice-err', role: 'alert' }, 'Paste a GitHub fine-grained token (it starts with github_pat_).')); token.focus(); return; }
      if (!pass.value) { pass.focus(); return; }
      setBusy(submit, true, 'Unlocking…');
      try {
        const r = await unlock({ passphrase: pass.value, token: remembered ? null : tok, remember: remember.checked }, (s) => { submit.lastChild.textContent = s; });
        if (r.needsSetup) return firstSetup(r.conn, r.token, remember.checked);
        onUnlocked(r.session);
      } catch (err) {
        setBusy(submit, false);
        const text = err instanceof CryptoError && err.code === 'wrong_secret'
          ? (remembered ? 'Wrong passphrase. If you changed it on another device, choose “Use a different token” and paste your token again.' : 'Wrong passphrase.')
          : explain(err);
        put(msg, el('div', { class: 'notice notice-err', role: 'alert' }, text));
        if (err.code === 'unauthorized' && remembered) put(msg, el('button', { class: 'link-btn', type: 'button', on: { click: () => signIn({ useToken: true }) } }, 'Paste a new token'));
        pass.select();
      }
    }
  }

  function firstSetup(conn, token, rememberDefault) {
    clear(card);
    const p1 = passInput('new-password', 'new-pass');
    const p2 = passInput('new-password', 'new-pass-2');
    const remember = el('input', { type: 'checkbox', id: 'remember2', checked: rememberDefault });
    const msg = status();
    const submit = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Create encrypted vault');
    const form = el('form', { class: 'stack', on: { submit: go } },
      el('p', { class: 'help' }, `Connected to ${CONFIG.owner}/${CONFIG.vaultRepo}${conn.vaultPrivate ? ' (private)' : ' — note: this repository is PUBLIC; contents are still encrypted, but make it private for defence in depth'}. It has no vault yet.`),
      field('Choose a vault passphrase', p1, 'This passphrase encrypts every map. It is never stored or sent anywhere. Use 16+ characters or 4+ random words.'),
      field('Repeat the passphrase', p2),
      el('label', { class: 'check', for: 'remember2' }, remember, el('span', {}, 'Remember the token on this device, encrypted with this passphrase')),
      msg, submit,
      el('button', { class: 'btn btn-ghost btn-block', type: 'button', on: { click: restoreFromBackup } }, 'Restore from a backup file instead'));
    put(card, el('h2', { class: 'card-title', id: 'auth-title' }, '✨ Set up your vault'), form);
    p1.focus();

    async function go(e) {
      e.preventDefault();
      clear(msg);
      const problem = passphraseProblem(p1.value);
      if (problem) { put(msg, el('div', { class: 'notice notice-err', role: 'alert' }, problem)); p1.focus(); return; }
      if (p1.value !== p2.value) { put(msg, el('div', { class: 'notice notice-err', role: 'alert' }, 'The passphrases do not match.')); p2.focus(); return; }
      setBusy(submit, true, 'Creating vault…');
      try {
        const r = await setup({ conn, token, passphrase: p1.value, remember: remember.checked });
        showRecoveryCode(r.recoveryCode, () => onUnlocked(r.session));
      } catch (err) {
        setBusy(submit, false);
        put(msg, el('div', { class: 'notice notice-err', role: 'alert' }, explain(err)));
      }
    }

    async function restoreFromBackup() {
      const text = await readFileText();
      if (!text) return;
      let backup;
      try { backup = JSON.parse(text); } catch { backup = null; }
      if (!backup || backup.neuron !== 'backup' || !backup.keyring) { put(clear(msg), el('div', { class: 'notice notice-err', role: 'alert' }, 'That is not a Neuron vault backup.')); return; }
      clear(card);
      const pass = passInput('current-password', 'restore-pass');
      const m2 = status();
      const btn = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Restore vault');
      put(card, el('h2', { class: 'card-title', id: 'auth-title' }, 'Restore from backup'),
        el('form', { class: 'stack', on: { submit: async (e) => {
          e.preventDefault(); clear(m2); setBusy(btn, true, 'Restoring…');
          try { onUnlocked((await restore({ conn, token, backup, passphrase: pass.value, remember: remember.checked })).session); } catch (err) {
            setBusy(btn, false);
            put(m2, el('div', { class: 'notice notice-err', role: 'alert' }, err.code === 'wrong_secret' ? 'Wrong passphrase for this backup.' : explain(err)));
          }
        } } },
          el('p', { class: 'help' }, `Backup from ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : 'an unknown date'} with ${Object.keys(backup.maps || {}).length} maps.`),
          field('Passphrase used when the backup was made', pass), m2, btn,
          el('button', { class: 'btn btn-ghost btn-block', type: 'button', on: { click: () => firstSetup(conn, token, rememberDefault) } }, 'Back')));
      pass.focus();
    }
  }

  function showRecoveryCode(code, done) {
    clear(card);
    const ack = el('input', { type: 'checkbox', id: 'ack' });
    const cont = el('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true, on: { click: done } }, 'Continue to My Maps');
    ack.addEventListener('change', () => { cont.disabled = !ack.checked; });
    const copy = el('button', { class: 'btn btn-sm', type: 'button' }, 'Copy');
    copy.addEventListener('click', async () => flashButton(copy, (await copyText(code)) ? '✓ Copied' : 'Copy failed'));
    put(card, 
      el('h2', { class: 'card-title', id: 'auth-title' }, '🗝 Save your recovery code'),
      el('p', { class: 'help' }, 'If you ever forget your passphrase, this code is the only way back into your maps. It is shown once. Store it in a password manager or on paper — not in this repository.'),
      el('div', { class: 'recovery-code', tabindex: '0', 'aria-label': 'Recovery code' }, code),
      el('div', { class: 'row' }, copy, el('button', { class: 'btn btn-sm btn-ghost', type: 'button', on: { click: () => download('neuron-recovery-code.txt', `Neuron vault recovery code\n${CONFIG.owner}/${CONFIG.vaultRepo}\n\n${code}\n`, 'text/plain') } }, 'Download as text')),
      el('label', { class: 'check', for: 'ack' }, ack, el('span', {}, 'I have stored my recovery code somewhere safe.')),
      cont);
    cont.scrollIntoView({ block: 'nearest' });
  }

  function recovery() {
    clear(card);
    const token = el('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
    const code = el('input', { class: 'input', autocomplete: 'off', spellcheck: 'false', placeholder: 'XXXX-XXXX-…' });
    const p1 = passInput('new-password', 'rec-pass');
    const p2 = passInput('new-password', 'rec-pass-2');
    const remember = el('input', { type: 'checkbox', id: 'remember3', checked: true });
    const msg = status();
    const submit = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Reset passphrase & unlock');
    put(card, el('h2', { class: 'card-title', id: 'auth-title' }, 'Recover with your recovery code'),
      el('form', { class: 'stack', on: { submit: go } },
        field('GitHub token', token), field('Recovery code', code), field('New vault passphrase', p1), field('Repeat new passphrase', p2),
        el('label', { class: 'check', for: 'remember3' }, remember, el('span', {}, 'Remember the token on this device')),
        msg, submit,
        el('button', { class: 'btn btn-ghost btn-block', type: 'button', on: { click: () => signIn() } }, 'Back to sign-in')));
    token.focus();

    async function go(e) {
      e.preventDefault();
      clear(msg);
      const problem = passphraseProblem(p1.value);
      if (!TOKEN_RE.test(token.value.trim())) { put(msg, el('div', { class: 'notice notice-err', role: 'alert' }, 'Paste a GitHub fine-grained token.')); return; }
      if (problem) { put(msg, el('div', { class: 'notice notice-err', role: 'alert' }, problem)); return; }
      if (p1.value !== p2.value) { put(msg, el('div', { class: 'notice notice-err', role: 'alert' }, 'The passphrases do not match.')); return; }
      setBusy(submit, true, 'Recovering…');
      try {
        onUnlocked((await recover({ token: token.value, recoveryCode: code.value, newPassphrase: p1.value, remember: remember.checked })).session);
      } catch (err) {
        setBusy(submit, false);
        put(msg, el('div', { class: 'notice notice-err', role: 'alert' }, err.code === 'wrong_secret' ? 'That recovery code does not unlock this vault.' : explain(err)));
      }
    }
  }

  signIn({ notice: app.lockNotice ? el('div', { class: 'notice' }, app.lockNotice) : null });
  app.lockNotice = null;
}
