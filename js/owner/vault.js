// Encrypted personal map library stored in the private vault repository.
//
//   keyring.json        KDF parameters + wrapped vault key
//   manifest.enc        encrypted index of all maps (titles, topics, dates, progress, share state)
//   maps/<id>.enc       encrypted map content
//
// Every change is one commit built on the head it read; if another device committed first, the
// operation re-reads the manifest, re-applies itself and tries again. Nothing is force-pushed.

import { CONFIG } from '../config.js';
import { randomId, isId } from '../core/b64.js';
import { loadMapFromObject } from '../core/ncf.js';
import { seal, open } from './crypto.js';
import { GitHubError } from './github.js';

export const PATH = Object.freeze({
  keyring: 'keyring.json',
  manifest: 'manifest.enc',
  map: (id) => `maps/${id}.enc`,
});
const AAD = { manifest: 'vault/manifest', map: (id) => `vault/maps/${id}` };
const MAX_ATTEMPTS = 4;
const TITLE_MAX = 160;

export const emptyManifest = () => ({ neuron: 'manifest', v: 1, maps: [] });

export function cleanTitle(t, fallback = 'Untitled map') {
  const s = String(t ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  return s || fallback;
}

function checkManifest(m) {
  if (!m || m.neuron !== 'manifest' || m.v !== 1 || !Array.isArray(m.maps)) {
    throw new GitHubError('bad_request', 'The vault index is in an unrecognised format.');
  }
  return m;
}

export function createVault(gh, key, { repo = CONFIG.vaultRepo, branch = CONFIG.branch, now = () => new Date().toISOString() } = {}) {
  let manifest = emptyManifest();

  async function manifestAt(head) {
    const f = await gh.readText(repo, PATH.manifest, head);
    return f ? checkManifest(await open(key, f.text, AAD.manifest)) : emptyManifest();
  }

  async function head() {
    const sha = await gh.headSha(repo, branch);
    if (!sha) throw new GitHubError('empty_repo', 'The vault repository is empty — set up your vault first.');
    return sha;
  }

  async function refresh() {
    manifest = await manifestAt(await head());
    return list();
  }

  const list = () => structuredClone(manifest.maps);
  const entry = (id) => manifest.maps.find((m) => m.id === id) || null;

  /** Re-read → apply → commit, retrying on conflicts. `apply` mutates the manifest copy it receives. */
  async function mutate(message, apply, files = []) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const parent = await head();
      const next = structuredClone(await manifestAt(parent));
      const extra = (await apply(next, parent)) || [];
      const text = await seal(key, next, AAD.manifest);
      try {
        await gh.commit(repo, { parent, message, branch, files: [...files, ...extra, { path: PATH.manifest, text }] });
        manifest = next;
        return list();
      } catch (e) {
        if (e.code !== 'conflict') throw e;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1) + Math.random() * 250));
      }
    }
    throw new GitHubError('conflict', 'Your library kept changing on another device while saving. Nothing was overwritten — please try again.');
  }

  async function readMap(id) {
    if (!isId(id)) throw new GitHubError('not_found', 'That map does not exist.');
    const f = await gh.readText(repo, PATH.map(id), await head());
    if (!f) throw new GitHubError('not_found', 'That map is no longer in your library.');
    const record = await open(key, f.text, AAD.map(id));
    const r = loadMapFromObject(record?.map);
    if (!r.ok) throw new GitHubError('bad_request', 'The stored map failed validation.');
    return r.data;
  }

  /** Create (no id) or replace (id) a map's content and metadata in one commit. */
  async function saveMap({ id, title, map }) {
    if (!loadMapFromObject(map).ok) throw new GitHubError('bad_request', 'This map is not valid, so it was not saved.');
    if (id != null && !isId(id)) throw new GitHubError('bad_request', 'Invalid map id.');
    id = id || randomId();
    const ts = now();
    const text = await seal(key, { v: 1, map }, AAD.map(id));
    await mutate('Neuron: save map', (m) => {
      const meta = { title: cleanTitle(title, map.topic), topic: map.topic, depth: map.depth, nodes: map.nodes.length, links: map.links.length, steps: map.learningPath.length, updatedAt: ts };
      const existing = m.maps.find((x) => x.id === id);
      if (existing) Object.assign(existing, meta);
      else m.maps.push({ id, createdAt: ts, progress: [], share: null, ...meta });
    }, [{ path: PATH.map(id), text }]);
    return id;
  }

  async function update(id, message, fn) {
    return mutate(message, (m) => {
      const e = m.maps.find((x) => x.id === id);
      if (!e) throw new GitHubError('not_found', 'That map is no longer in your library.');
      fn(e);
    });
  }

  const renameMap = (id, title) => update(id, 'Neuron: rename map', (e) => { e.title = cleanTitle(title, e.topic); e.updatedAt = now(); });
  const setProgress = (id, done) => update(id, 'Neuron: update progress', (e) => { e.progress = [...new Set(done)].slice(0, 2000); });
  const setShare = (id, share) => update(id, 'Neuron: update sharing', (e) => { e.share = share; });

  async function deleteMap(id) {
    return mutate('Neuron: delete map', async (m, parent) => {
      const i = m.maps.findIndex((x) => x.id === id);
      if (i < 0) return [];
      m.maps.splice(i, 1);
      const exists = await gh.readText(repo, PATH.map(id), parent);
      return exists ? [{ path: PATH.map(id), delete: true }] : [];
    });
  }

  /** Encrypted backup of the whole vault. Safe to store anywhere: it is useless without the passphrase or recovery code. */
  async function exportBackup() {
    const parent = await head();
    const keyring = await gh.readText(repo, PATH.keyring, parent);
    const man = await gh.readText(repo, PATH.manifest, parent);
    const ids = man ? checkManifest(await open(key, man.text, AAD.manifest)).maps.map((x) => x.id) : [];
    const maps = {};
    for (const id of ids) {
      const f = await gh.readText(repo, PATH.map(id), parent);
      if (f) maps[id] = f.text;
    }
    return { neuron: 'backup', v: 1, exportedAt: now(), keyring: keyring ? JSON.parse(keyring.text) : null, manifest: man?.text || null, maps };
  }

  /**
   * Merge a backup into this vault. `backupKey` decrypts the backup (the current key for a backup
   * of this vault). Maps missing here, or newer in the backup, are written; nothing newer is replaced.
   */
  async function importBackup(backup, backupKey = key) {
    if (!backup || backup.neuron !== 'backup' || backup.v !== 1 || typeof backup.maps !== 'object') {
      throw new GitHubError('bad_request', 'This is not a Neuron vault backup.');
    }
    const theirs = backup.manifest ? checkManifest(await open(backupKey, backup.manifest, AAD.manifest)) : emptyManifest();
    const decrypted = new Map();
    for (const e of theirs.maps) {
      if (!isId(e.id) || typeof backup.maps[e.id] !== 'string') continue;
      decrypted.set(e.id, await open(backupKey, backup.maps[e.id], AAD.map(e.id)));
    }
    const summary = { added: 0, updated: 0, skipped: 0 };
    await mutate('Neuron: import backup', async (m) => {
      Object.assign(summary, { added: 0, updated: 0, skipped: 0 });
      const files = [];
      for (const e of theirs.maps) {
        const record = decrypted.get(e.id);
        const loaded = record && loadMapFromObject(record.map);
        if (!loaded?.ok) { summary.skipped++; continue; }
        const mine = m.maps.find((x) => x.id === e.id);
        if (mine && !(String(e.updatedAt) > String(mine.updatedAt))) { summary.skipped++; continue; }
        files.push({ path: PATH.map(e.id), text: await seal(key, { v: 1, map: loaded.data }, AAD.map(e.id)) });
        const map = loaded.data;
        const ts = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : now());
        const clean = {
          id: e.id, title: cleanTitle(e.title, map.topic), topic: map.topic, depth: map.depth,
          nodes: map.nodes.length, links: map.links.length, steps: map.learningPath.length,
          createdAt: ts(e.createdAt), updatedAt: ts(e.updatedAt),
          progress: Array.isArray(e.progress) ? e.progress.filter((x) => typeof x === 'string').slice(0, 2000) : [],
          share: mine?.share ?? null,
        };
        if (mine) { Object.assign(mine, clean); summary.updated++; } else { m.maps.push(clean); summary.added++; }
      }
      return files;
    });
    return summary;
  }

  return { refresh, list, entry, readMap, saveMap, renameMap, setProgress, setShare, deleteMap, exportBackup, importBackup };
}

/** Write a brand-new keyring + empty manifest. Refuses if the vault already has a keyring. */
export async function initialiseVault(gh, keyring, key, { repo = CONFIG.vaultRepo, branch = CONFIG.branch } = {}) {
  let parent = await gh.headSha(repo, branch);
  if (!parent) {
    parent = await gh.initRepo(repo, { path: 'README.md', text: '# Neuron vault\n\nEncrypted personal knowledge maps. Contents are unreadable without the owner\'s passphrase.\n', message: 'Initialise Neuron vault', branch });
  }
  if (await gh.readText(repo, PATH.keyring, parent)) {
    throw new GitHubError('conflict', 'This vault is already set up. Unlock it with its passphrase instead.');
  }
  const manifestText = await seal(key, emptyManifest(), AAD.manifest);
  await gh.commit(repo, {
    parent, branch, message: 'Neuron: create vault',
    files: [{ path: PATH.keyring, text: JSON.stringify(keyring, null, 2) }, { path: PATH.manifest, text: manifestText }],
  });
}

/** Restore a backup into an empty (keyring-less) vault exactly as it was. */
export async function restoreVault(gh, backup, { repo = CONFIG.vaultRepo, branch = CONFIG.branch } = {}) {
  if (!backup || backup.neuron !== 'backup' || backup.v !== 1 || !backup.keyring) throw new GitHubError('bad_request', 'This is not a complete Neuron vault backup.');
  let parent = await gh.headSha(repo, branch);
  if (!parent) parent = await gh.initRepo(repo, { path: 'README.md', text: '# Neuron vault\n', message: 'Initialise Neuron vault', branch });
  if (await gh.readText(repo, PATH.keyring, parent)) throw new GitHubError('conflict', 'This vault already has a keyring. Import the backup from Settings instead.');
  const files = [{ path: PATH.keyring, text: JSON.stringify(backup.keyring, null, 2) }];
  if (backup.manifest) files.push({ path: PATH.manifest, text: backup.manifest });
  for (const [id, text] of Object.entries(backup.maps || {})) if (isId(id) && typeof text === 'string') files.push({ path: PATH.map(id), text });
  await gh.commit(repo, { parent, branch, message: 'Neuron: restore vault from backup', files });
}
