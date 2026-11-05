// Test harness only: runs the real owner app against an in-browser fake GitHub.
// State persists in localStorage so reloads behave like a real remote.
import { createFakeGitHub } from './helpers/fake-github.mjs';

if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  document.body.textContent = 'The Neuron test harness only runs on a local development server.';
  throw new Error('e2e harness disabled outside localhost');
}

const KEY = 'neuron.e2e.fake';
const fake = createFakeGitHub();
try {
  const saved = localStorage.getItem(KEY);
  if (saved) fake.load(JSON.parse(saved));
} catch { /* start empty */ }
if (!fake.files('NeuronVault').length && !localStorage.getItem(KEY)) {
  fake.repo('NeuronVault');
  fake.repo('NeuronShares', { private: false });
}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(fake.dump())); } catch { /* quota */ } };
window.__fake = fake;
// Test-only credentials for the fake GitHub above. They unlock nothing real.
window.__e2e = { token: fake.token, passphrase: 'e2e river ember cloud tide', newPassphrase: 'e2e second passphrase value' };
window.__resetFake = () => { localStorage.removeItem(KEY); localStorage.removeItem('neuron.device.v1'); location.hash = ''; location.reload(); };

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://api.github.com/')) {
    const res = await fake.fetchImpl(url, init);
    if ((init.method || 'GET') !== 'GET') persist();
    return res;
  }
  const pages = 'https://hhrishikeshh.github.io/NeuronShares/';
  if (url.startsWith(pages)) {
    let path = new URL(url).pathname.slice('/NeuronShares/'.length);
    if (!path || path.endsWith('/')) path += 'index.html';
    const text = fake.readDirect('NeuronShares', path);
    return text == null ? new Response('Not found', { status: 404 }) : new Response(text, { status: 200 });
  }
  return realFetch(input, init);
};

await import('../js/owner/app.js');
