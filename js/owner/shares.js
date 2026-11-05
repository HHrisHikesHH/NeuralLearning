// Explicit, owner-initiated publishing of a single map as a public read-only snapshot.
// Order across the two repositories (so any failure is recoverable, never silent):
//   1. vault marks the share "publishing"   2. one commit writes s/<id>/{index.html,map.json,og.*}
//   3. vault marks it "published"            → reconcile() repairs anything interrupted between steps.

import { CONFIG, sharePageUrl } from '../config.js';
import { randomId, isId } from '../core/b64.js';
import { toNCF } from '../core/ncf.js';
import { renderSharePage, renderSharesIndex } from './share-page.js';
import { GitHubError } from './github.js';

const dir = (id) => `s/${id}`;
const MAX_ATTEMPTS = 4;

export function createShares(gh, vault, {
  repo = CONFIG.sharesRepo, branch = CONFIG.branch, now = () => new Date().toISOString(),
  renderImage = null, fetchImpl = (...a) => globalThis.fetch(...a),
} = {}) {

  async function commitWithRetry(message, buildFiles) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let parent = await gh.headSha(repo, branch);
      if (!parent) parent = await gh.initRepo(repo, { path: '.nojekyll', text: '', message: 'Initialise Neuron shares', branch });
      const files = await buildFiles(parent);
      if (!files.length) return parent;
      try {
        return await gh.commit(repo, { parent, branch, message, files });
      } catch (e) {
        if (e.code !== 'conflict') throw e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw new GitHubError('conflict', 'The shares repository kept changing while publishing. Please try again.');
  }

  /** Publish (or update) the public snapshot of one saved map. Returns the public URL. */
  async function publish(entry, map, { title = entry.title, positions = [] } = {}) {
    const id = isId(entry.share?.id) ? entry.share.id : randomId();
    const ts = now();
    const firstPublished = entry.share?.publishedAt || ts;
    await vault.setShare(entry.id, { id, status: 'publishing', publishedAt: entry.share?.publishedAt || null, updatedAt: ts });

    let image = null;
    if (renderImage) {
      try {
        image = await renderImage({ title, depth: map.depth, concepts: map.nodes.length, domains: map.categories.length, positions, colors: map.categories.map((c) => c.color) });
      } catch { image = null; }
    }
    const imageFile = image ? `og.${image.ext}` : null;
    const snapshot = { neuronShare: 1, publishedAt: firstPublished, updatedAt: ts, title, map: toNCF(map) };
    const html = renderSharePage({ shareId: id, title, map, imageFile, imageType: image?.mime, publishedAt: firstPublished });

    await commitWithRetry('Neuron: publish shared map', async (parent) => {
      const files = [
        { path: `${dir(id)}/index.html`, text: html },
        { path: `${dir(id)}/map.json`, text: JSON.stringify(snapshot) },
      ];
      if (image) files.push({ path: `${dir(id)}/${imageFile}`, base64: image.base64 });
      for (const f of await gh.listDir(repo, dir(id), parent)) {
        if (/\/og\.(png|jpg)$/.test(f.path) && !f.path.endsWith(`/${imageFile}`)) files.push({ path: f.path, delete: true });
      }
      if (!(await gh.readText(repo, '.nojekyll', parent))) files.push({ path: '.nojekyll', text: '' });
      if (!(await gh.readText(repo, 'index.html', parent))) files.push({ path: 'index.html', text: renderSharesIndex() });
      return files;
    });

    await vault.setShare(entry.id, { id, status: 'published', publishedAt: firstPublished, updatedAt: ts, url: sharePageUrl(id) });
    return { id, url: sharePageUrl(id), updatedAt: ts };
  }

  /** Remove the public snapshot. Copies already downloaded and git history cannot be recalled. */
  async function unpublish(entry) {
    const id = entry.share?.id;
    if (!isId(id)) return;
    await vault.setShare(entry.id, { ...entry.share, status: 'unpublishing' });
    await commitWithRetry('Neuron: unpublish shared map', async (parent) =>
      (await gh.listDir(repo, dir(id), parent)).filter((f) => f.type === 'file').map((f) => ({ path: f.path, delete: true })));
    await vault.setShare(entry.id, null);
  }

  /** Finish or roll back shares left half-done by an interrupted publish/unpublish. */
  async function reconcile(entries) {
    const pending = entries.filter((e) => e.share && e.share.status !== 'published');
    if (!pending.length) return 0;
    const head = await gh.headSha(repo, branch);
    for (const e of pending) {
      const live = head && isId(e.share.id) ? await gh.readText(repo, `${dir(e.share.id)}/map.json`, head) : null;
      let snap = null;
      try { snap = live && JSON.parse(live.text); } catch { snap = null; }
      if (e.share.status === 'unpublishing') {
        if (live) await unpublish(e); else await vault.setShare(e.id, null);
      } else if (snap && snap.updatedAt === e.share.updatedAt) {
        await vault.setShare(e.id, { ...e.share, status: 'published', publishedAt: snap.publishedAt, url: sharePageUrl(e.share.id) });
      } else if (live) {
        await vault.setShare(e.id, { ...e.share, status: 'published', publishedAt: snap?.publishedAt || e.share.publishedAt, url: sharePageUrl(e.share.id), stale: true });
      } else {
        await vault.setShare(e.id, null);
      }
    }
    return pending.length;
  }

  /** Poll GitHub Pages until the new snapshot is served (Pages usually deploys within a minute). */
  async function waitUntilLive(id, updatedAt, { timeoutMs = 240_000, interval = 5000, onTick } = {}) {
    const url = `${sharePageUrl(id)}map.json`;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetchImpl(`${url}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' });
        if (res.ok && (await res.json()).updatedAt === updatedAt) return true;
      } catch { /* not live yet */ }
      onTick?.(Math.round((Date.now() - start) / 1000));
      await new Promise((r) => setTimeout(r, interval));
    }
    return false;
  }

  return { publish, unpublish, reconcile, waitUntilLive };
}
