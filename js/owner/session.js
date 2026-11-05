// Owner session: GitHub token + vault key, held in memory only while unlocked.
// The token may be remembered on a device, but only encrypted with the vault passphrase.

import { CONFIG } from '../config.js';
import { createGitHub, GitHubError } from './github.js';
import { createVault, initialiseVault, restoreVault, PATH } from './vault.js';
import { createShares } from './shares.js';
import { renderOgImage } from './og-image.js';
import {
  createKeyring, unlockWithPassphrase, unlockWithRecovery, rewrapWithPassphrase, toSessionKey, sealSecret, openSecret, CryptoError,
} from './crypto.js';

const DEVICE_KEY = 'neuron.device.v1';

export const device = {
  get() {
    try { const s = localStorage.getItem(DEVICE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
  },
  async save(passphrase, token) {
    const rec = await sealSecret(passphrase, token, CONFIG.kdfIterations);
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(rec)); return true; } catch { return false; }
  },
  forget() {
    try { localStorage.removeItem(DEVICE_KEY); } catch { /* storage unavailable */ }
  },
};

async function resolveToken({ token, passphrase }) {
  if (token) return token.trim();
  const rec = device.get();
  if (!rec) throw new CryptoError('no_device', 'Paste your GitHub token to sign in on this device.');
  return openSecret(passphrase, rec);
}

/** Check both storage repositories are reachable with this token. */
async function connect(token) {
  const gh = createGitHub(token);
  const check = async (repo) => {
    try { return await gh.getRepo(repo); } catch (e) {
      if (e.code === 'not_found') throw new GitHubError('not_found', `Repository ${CONFIG.owner}/${repo} was not found, or the token was not given access to it.`);
      throw e;
    }
  };
  const [vaultRepo, sharesRepo] = await Promise.all([check(CONFIG.vaultRepo), check(CONFIG.sharesRepo)]);
  return { gh, vaultPrivate: !!vaultRepo.private, sharesPrivate: !!sharesRepo.private };
}

async function readKeyring(gh) {
  const head = await gh.headSha(CONFIG.vaultRepo);
  if (!head) return null;
  const f = await gh.readText(CONFIG.vaultRepo, PATH.keyring, head);
  if (!f) return null;
  try { return JSON.parse(f.text); } catch { throw new CryptoError('corrupt', 'The vault keyring file is damaged. Restore it from a backup.'); }
}

function makeSession(conn, key) {
  const vault = createVault(conn.gh, key);
  const shares = createShares(conn.gh, vault, { renderImage: renderOgImage });
  return { ...conn, vault, shares, unlockedAt: Date.now() };
}

/**
 * Unlock with passphrase (+ token on a new device).
 * Returns { session } or { needsSetup: true, conn, token } when the vault has no keyring yet.
 */
export async function unlock({ passphrase, token, remember }, onStep = () => {}) {
  onStep('Decrypting your sign-in…');
  const tok = await resolveToken({ token, passphrase });
  onStep('Connecting to GitHub…');
  const conn = await connect(tok);
  onStep('Reading your vault…');
  const keyring = await readKeyring(conn.gh);
  if (!keyring) return { needsSetup: true, conn, token: tok };
  onStep('Unlocking your vault…');
  const key = await unlockWithPassphrase(keyring, passphrase);
  if (token && remember) await device.save(passphrase, tok);
  const session = makeSession(conn, key);
  onStep('Loading your maps…');
  await session.vault.refresh();
  return { session };
}

export async function setup({ conn, token, passphrase, remember }) {
  const { keyring, key, recoveryCode } = await createKeyring(passphrase, CONFIG.kdfIterations);
  await initialiseVault(conn.gh, keyring, key);
  if (remember) await device.save(passphrase, token);
  const session = makeSession(conn, key);
  await session.vault.refresh();
  return { session, recoveryCode };
}

export async function restore({ conn, token, backup, passphrase, remember }) {
  const key = await unlockWithPassphrase(backup.keyring, passphrase);
  await restoreVault(conn.gh, backup);
  if (remember) await device.save(passphrase, token);
  const session = makeSession(conn, key);
  await session.vault.refresh();
  return { session };
}

async function writeKeyring(gh, keyring) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const parent = await gh.headSha(CONFIG.vaultRepo);
    try {
      await gh.commit(CONFIG.vaultRepo, { parent, message: 'Neuron: update keyring', files: [{ path: PATH.keyring, text: JSON.stringify(keyring, null, 2) }] });
      return;
    } catch (e) { if (e.code !== 'conflict') throw e; }
  }
  throw new GitHubError('conflict', 'The vault kept changing while updating the passphrase. Please try again.');
}

/** Forgotten passphrase: unlock with the recovery code and set a new passphrase. */
export async function recover({ token, recoveryCode, newPassphrase, remember }) {
  const tok = await resolveTokenForRecovery(token);
  const conn = await connect(tok);
  const keyring = await readKeyring(conn.gh);
  if (!keyring) throw new GitHubError('not_found', 'This vault has not been set up yet.');
  const ext = await unlockWithRecovery(keyring, recoveryCode, { extractable: true });
  await writeKeyring(conn.gh, await rewrapWithPassphrase(keyring, ext, newPassphrase, CONFIG.kdfIterations));
  if (remember) await device.save(newPassphrase, tok);
  else device.forget();
  const session = makeSession(conn, await toSessionKey(ext));
  await session.vault.refresh();
  return { session };
}

function resolveTokenForRecovery(token) {
  if (token) return token.trim();
  throw new CryptoError('no_device', 'Paste your GitHub token: a saved token cannot be decrypted without the old passphrase.');
}

export async function changePassphrase(session, { current, next, token }) {
  const keyring = await readKeyring(session.gh);
  const ext = await unlockWithPassphrase(keyring, current, { extractable: true });
  await writeKeyring(session.gh, await rewrapWithPassphrase(keyring, ext, next, CONFIG.kdfIterations));
  if (device.get()) {
    const tok = token || await openSecret(current, device.get());
    await device.save(next, tok);
  }
}

/** Calls onIdle after `minutes` without user input. Returns a stop function. */
export function idleTimer(minutes, onIdle) {
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
  const iv = setInterval(() => { if (Date.now() - last > minutes * 60_000) onIdle(); }, 20_000);
  return () => { clearInterval(iv); events.forEach((e) => window.removeEventListener(e, bump)); };
}
