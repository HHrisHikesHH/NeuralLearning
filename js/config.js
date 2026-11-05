// Public configuration. Nothing here is secret: repository names and URLs only.
// Credentials are never stored in source; see README "Owner setup".

export const CONFIG = Object.freeze({
  owner: 'HHrisHikesHH',
  appRepo: 'NeuralLearning',
  vaultRepo: 'NeuronVault',
  sharesRepo: 'NeuronShares',
  branch: 'main',
  pagesOrigin: 'https://hhrishikeshh.github.io',
  apiBase: 'https://api.github.com',
  kdfIterations: 1_000_000,
  idleLockMinutes: 15,
});

const isLocalDev = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

export const appBaseUrl = () => `${CONFIG.pagesOrigin}/${CONFIG.appRepo}/`;
export const sharesBaseUrl = () => `${CONFIG.pagesOrigin}/${CONFIG.sharesRepo}/`;
export const sharePageUrl = (id) => `${sharesBaseUrl()}s/${id}/`;

/** Where the fallback viewer (view.html?s=…) reads a snapshot from. Local dev reads test fixtures. */
export const shareMapUrl = (id) => (isLocalDev()
  ? `${location.origin}/tests/fixtures/shares/s/${id}/map.json`
  : `${sharePageUrl(id)}map.json`);
