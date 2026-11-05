// Minimal GitHub REST client for the owner app.
// Writes go through the Git Data API as one commit per operation; the final ref update uses
// force:false, so a commit made elsewhere in the meantime is rejected instead of overwritten.

import { CONFIG } from '../config.js';
import { utf8, fromUtf8, bytesToB64, b64ToBytes } from '../core/b64.js';

export class GitHubError extends Error {
  constructor(code, message, status = 0) { super(message); this.name = 'GitHubError'; this.code = code; this.status = status; }
}

const MESSAGES = {
  unauthorized: 'GitHub rejected the token. It may have expired or been revoked — paste a new one.',
  forbidden: 'The token does not have permission for this. It needs Contents: Read and write on the vault and shares repositories.',
  not_found: 'Not found. Check that the repository exists and the token has access to it.',
  rate_limited: 'GitHub rate limit reached. Please wait a few minutes and try again.',
  network: 'Could not reach GitHub. Check your connection and try again.',
  server: 'GitHub is having trouble right now. Please try again shortly.',
  conflict: 'Something else changed this repository at the same time.',
  empty_repo: 'The repository is empty.',
  bad_request: 'GitHub could not process the request.',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

export function createGitHub(token, {
  fetchImpl = (...a) => globalThis.fetch(...a), apiBase = CONFIG.apiBase, owner = CONFIG.owner, retryDelays = [600, 1800],
} = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(token)) {
    throw new GitHubError('unauthorized', 'That does not look like a GitHub token.');
  }

  async function request(method, path, body, { allow = [] } = {}) {
    const attempts = method === 'GET' ? retryDelays.length + 1 : 1;
    for (let i = 0; i < attempts; i++) {
      let res;
      try {
        res = await fetchImpl(apiBase + path, {
          method,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      } catch {
        if (i < attempts - 1) { await sleep(retryDelays[i]); continue; }
        throw new GitHubError('network', MESSAGES.network);
      }
      if (allow.includes(res.status)) return { status: res.status, data: null };
      if (res.ok) return { status: res.status, data: res.status === 204 ? null : await res.json() };
      if (res.status >= 500 && i < attempts - 1) { await sleep(retryDelays[i]); continue; }
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch { /* ignore */ }
      const limited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after')));
      const code = res.status === 401 ? 'unauthorized'
        : limited ? 'rate_limited'
          : res.status === 403 ? 'forbidden'
            : res.status === 404 ? 'not_found'
              : res.status === 409 && /empty/i.test(msg) ? 'empty_repo'
                : res.status === 409 ? 'conflict'
                  : res.status >= 500 ? 'server' : 'bad_request';
      throw new GitHubError(code, MESSAGES[code] + (code === 'bad_request' && msg ? ` (${msg})` : ''), res.status);
    }
    throw new GitHubError('network', MESSAGES.network);
  }

  const R = (repo) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function getRepo(repo) {
    return (await request('GET', R(repo))).data;
  }

  async function headSha(repo, branch = CONFIG.branch) {
    try {
      const r = await request('GET', `${R(repo)}/git/ref/heads/${encodeURIComponent(branch)}`, null, { allow: [404] });
      return r.data?.object?.sha || null;
    } catch (e) {
      if (e.code === 'empty_repo') return null;
      throw e;
    }
  }

  async function readBytes(repo, path, ref) {
    const r = await request('GET', `${R(repo)}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`, null, { allow: [404] });
    if (!r.data) return null;
    if (Array.isArray(r.data) || r.data.type !== 'file') throw new GitHubError('bad_request', `${path} is not a file`);
    let b64 = r.data.content;
    if (r.data.encoding !== 'base64' || !b64) {
      b64 = (await request('GET', `${R(repo)}/git/blobs/${r.data.sha}`)).data.content;
    }
    return { bytes: b64ToBytes(b64 || ''), sha: r.data.sha };
  }

  async function readText(repo, path, ref) {
    const f = await readBytes(repo, path, ref);
    return f && { text: fromUtf8(f.bytes), sha: f.sha };
  }

  async function listDir(repo, path, ref) {
    const r = await request('GET', `${R(repo)}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`, null, { allow: [404] });
    return Array.isArray(r.data) ? r.data.map((f) => ({ path: f.path, type: f.type, sha: f.sha })) : [];
  }

  /**
   * One atomic commit on top of `parent`. files: [{path, text} | {path, base64} | {path, delete: true}].
   * Throws GitHubError('conflict') if the branch moved since `parent` was read.
   */
  async function commit(repo, { parent, message, files, branch = CONFIG.branch }) {
    const base = (await request('GET', `${R(repo)}/git/commits/${parent}`)).data;
    const tree = [];
    for (const f of files) {
      if (f.delete) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
      const content = f.base64 ?? bytesToB64(utf8(f.text));
      const blob = (await request('POST', `${R(repo)}/git/blobs`, { content, encoding: 'base64' })).data;
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = (await request('POST', `${R(repo)}/git/trees`, { base_tree: base.tree.sha, tree })).data;
    const newCommit = (await request('POST', `${R(repo)}/git/commits`, { message, tree: newTree.sha, parents: [parent] })).data;
    try {
      await request('PATCH', `${R(repo)}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: newCommit.sha, force: false });
    } catch (e) {
      if (e.status === 422 || e.status === 409) throw new GitHubError('conflict', MESSAGES.conflict, e.status);
      throw e;
    }
    return newCommit.sha;
  }

  /** First commit in an empty repository (the Git Data API cannot create one). */
  async function initRepo(repo, { path, text, message, branch = CONFIG.branch }) {
    const body = { message, content: bytesToB64(utf8(text)), branch };
    try {
      await request('PUT', `${R(repo)}/contents/${encPath(path)}`, body);
    } catch (e) {
      if (e.status === 422 || e.status === 409) throw new GitHubError('conflict', MESSAGES.conflict, e.status);
      throw e;
    }
    return headSha(repo, branch);
  }

  return { getRepo, headSha, readBytes, readText, listDir, commit, initRepo };
}
