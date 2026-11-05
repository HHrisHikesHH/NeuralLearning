// In-memory GitHub REST fake covering the endpoints the owner app uses (Node and browser).
const sha = () => [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
const toB64 = (text) => { const b = new TextEncoder().encode(text); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const b64Len = (b64) => Math.floor((b64.length * 3) / 4);
const json = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function createFakeGitHub({ owner = 'HHrisHikesHH', token = 'github_pat_TESTTOKEN0123456789abcdef', largeThreshold = 1_000_000 } = {}) {
  const repos = new Map();
  const log = [];
  const faults = [];
  const hooks = { beforeRefUpdate: null };

  function repo(name, { exists = true, push = true, private: priv = true } = {}) {
    if (!repos.has(name)) repos.set(name, { blobs: new Map(), trees: new Map(), commits: new Map(), ref: null, exists, push, private: priv });
    return repos.get(name);
  }

  function treeAt(r, commitSha) {
    const c = r.commits.get(commitSha);
    return c ? r.trees.get(c.tree) : null;
  }

  function writeDirect(name, files, message = 'direct') {
    const r = repo(name);
    const base = r.ref ? new Map(treeAt(r, r.ref)) : new Map();
    for (const [path, content] of Object.entries(files)) {
      if (content === null) { base.delete(path); continue; }
      const b = sha(); r.blobs.set(b, toB64(content)); base.set(path, b);
    }
    const t = sha(); r.trees.set(t, base);
    const c = sha(); r.commits.set(c, { tree: t, parents: r.ref ? [r.ref] : [], message });
    r.ref = c;
    return c;
  }

  function readDirect(name, path) {
    const r = repos.get(name);
    const t = r?.ref && treeAt(r, r.ref);
    const b = t?.get(path);
    return b ? fromB64(r.blobs.get(b)) : null;
  }

  async function fetchImpl(url, init = {}) {
    const method = init.method || 'GET';
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const body = init.body ? JSON.parse(init.body) : null;
    log.push({ method, path, body });

    for (let i = 0; i < faults.length; i++) {
      const f = faults[i];
      if (f.method === method && f.match.test(path)) {
        faults.splice(i, 1);
        if (f.network) throw new TypeError('Failed to fetch');
        return json(f.status, { message: f.message || 'fault' }, f.headers);
      }
    }
    if (init.headers?.Authorization !== `Bearer ${token}`) return json(401, { message: 'Bad credentials' });

    const m = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!m || m[1] !== owner) return json(404, { message: 'Not Found' });
    const r = repos.get(m[2]);
    if (!r || !r.exists) return json(404, { message: 'Not Found' });
    const rest = m[3] || '';

    if (method === 'GET' && rest === '') return json(200, { name: m[2], private: r.private !== false, permissions: { push: r.push, pull: true } });

    if (method === 'GET' && rest === '/git/ref/heads/main') {
      if (!r.ref) return r.commits.size ? json(404, { message: 'Not Found' }) : json(409, { message: 'Git Repository is empty.' });
      return json(200, { object: { sha: r.ref } });
    }

    let mm;
    if (method === 'GET' && (mm = rest.match(/^\/contents\/(.+)$/))) {
      const ref = u.searchParams.get('ref');
      const commitSha = ref === 'main' ? r.ref : ref;
      const t = treeAt(r, commitSha);
      if (!t) return json(404, { message: 'No commit found' });
      const p = mm[1];
      if (t.has(p)) {
        const b = r.blobs.get(t.get(p));
        const big = b64Len(b) > largeThreshold;
        return json(200, { type: 'file', path: p, sha: t.get(p), encoding: big ? 'none' : 'base64', content: big ? '' : b });
      }
      const kids = [...t.keys()].filter((k) => k.startsWith(p + '/'));
      if (kids.length) return json(200, kids.map((k) => ({ type: 'file', path: k, sha: t.get(k) })));
      return json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (mm = rest.match(/^\/git\/blobs\/(\w+)$/))) {
      return r.blobs.has(mm[1]) ? json(200, { content: r.blobs.get(mm[1]), encoding: 'base64' }) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (mm = rest.match(/^\/git\/commits\/(\w+)$/))) {
      const c = r.commits.get(mm[1]);
      return c ? json(200, { sha: mm[1], tree: { sha: c.tree } }) : json(404, { message: 'Not Found' });
    }
    if (method === 'POST' && rest === '/git/blobs') {
      const b = sha(); r.blobs.set(b, body.content); return json(201, { sha: b });
    }
    if (method === 'POST' && rest === '/git/trees') {
      const base = new Map(r.trees.get(body.base_tree) || []);
      for (const e of body.tree) {
        if (e.sha === null) {
          if (!base.has(e.path)) return json(422, { message: 'GitRPC::BadObjectState' });
          base.delete(e.path);
        } else base.set(e.path, e.sha);
      }
      const t = sha(); r.trees.set(t, base); return json(201, { sha: t });
    }
    if (method === 'POST' && rest === '/git/commits') {
      const c = sha(); r.commits.set(c, { tree: body.tree, parents: body.parents, message: body.message }); return json(201, { sha: c });
    }
    if (method === 'PATCH' && rest === '/git/refs/heads/main') {
      if (!r.push) return json(403, { message: 'Resource not accessible by personal access token' });
      if (hooks.beforeRefUpdate) { const h = hooks.beforeRefUpdate; hooks.beforeRefUpdate = null; await h(m[2]); }
      const c = r.commits.get(body.sha);
      if (!body.force && (!c || c.parents[0] !== r.ref)) return json(422, { message: 'Update is not a fast forward' });
      r.ref = body.sha; return json(200, { object: { sha: body.sha } });
    }
    if (method === 'PUT' && (mm = rest.match(/^\/contents\/(.+)$/))) {
      if (r.ref && treeAt(r, r.ref).has(mm[1])) return json(422, { message: '"sha" wasn\'t supplied.' });
      writeDirect(m[2], { [mm[1]]: fromB64(body.content) }, body.message);
      return json(201, { content: { path: mm[1] } });
    }
    return json(404, { message: `Fake: unhandled ${method} ${rest}` });
  }

  function dump() {
    return [...repos].map(([name, r]) => ({
      name, ref: r.ref, exists: r.exists, push: r.push, private: r.private,
      blobs: [...r.blobs], trees: [...r.trees].map(([k, v]) => [k, [...v]]), commits: [...r.commits],
    }));
  }
  function load(data) {
    repos.clear();
    for (const d of data) {
      repos.set(d.name, { ref: d.ref, exists: d.exists, push: d.push, private: d.private, blobs: new Map(d.blobs), trees: new Map(d.trees.map(([k, v]) => [k, new Map(v)])), commits: new Map(d.commits) });
    }
  }

  return {
    fetchImpl, token, log, hooks, repo, writeDirect, readDirect, dump, load,
    fault: (f) => faults.push(f),
    head: (name) => repos.get(name)?.ref || null,
    files: (name) => { const r = repos.get(name); return r?.ref ? [...treeAt(r, r.ref).keys()].sort() : []; },
  };
}
