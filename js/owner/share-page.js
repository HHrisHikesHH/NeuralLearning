// Static HTML for one published map: per-map Open Graph / Twitter tags (crawlers do not run
// JavaScript) plus the shell that loads the read-only viewer from the app repository.

import { CONFIG } from '../config.js';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export function shareDescription(map) {
  const lead = `${map.nodes.length} concepts · ${String(map.depth).toUpperCase()} depth.`;
  return clip(`${lead} ${map.summary || ''}`, 200);
}

export function renderSharePage({ shareId, title, map, imageFile = null, imageType = 'image/png', publishedAt }) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(shareId)) throw new Error('Invalid share id');
  if (imageFile !== null && !/^og\.(png|jpg)$/.test(imageFile)) throw new Error('Invalid image file');
  const origin = CONFIG.pagesOrigin;
  const app = `${origin}/${CONFIG.appRepo}/`;
  const pageUrl = `${origin}/${CONFIG.sharesRepo}/s/${shareId}/`;
  const t = escapeHtml(clip(title, 120));
  const d = escapeHtml(shareDescription(map));
  const img = escapeHtml(imageFile ? pageUrl + imageFile : `${app}assets/og-default.jpg`);
  if (!imageFile) imageType = 'image/jpeg';
  const alt = escapeHtml(clip(`Knowledge map: ${title}`, 200));
  const csp = [
    "default-src 'none'",
    `script-src ${app}js/ https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/`,
    `style-src ${app}css/ https://fonts.googleapis.com`,
    'font-src https://fonts.gstatic.com',
    `img-src ${app}assets/ 'self' data:`,
    "connect-src 'self'",
    `manifest-src ${app}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en" data-share="page">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${t} · Neuron knowledge map</title>
<meta name="description" content="${d}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#020508">
<link rel="canonical" href="${escapeHtml(pageUrl)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Neuron">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta property="og:image" content="${img}">
<meta property="og:image:secure_url" content="${img}">
<meta property="og:image:type" content="${escapeHtml(imageType)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${alt}">
${publishedAt ? `<meta property="article:published_time" content="${escapeHtml(publishedAt)}">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta name="twitter:image:alt" content="${alt}">
<link rel="icon" href="${app}assets/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${app}assets/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${app}assets/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap">
<link rel="stylesheet" href="${app}css/tokens.css">
<link rel="stylesheet" href="${app}css/base.css">
<link rel="stylesheet" href="${app}css/mapview.css">
<link rel="stylesheet" href="${app}css/viewer.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js" integrity="sha384-su5kReKyYlIFrI62mbQRKXHzFobMa7BHp1cK6julLPbnYcCW9NIZKJiTODjLPeDh" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script type="module" src="${app}js/viewer/viewer.js"></script>
</head>
<body>
<canvas id="stars" aria-hidden="true"></canvas>
<div id="app">
<main class="vw-screen"><div class="vw-card">
<h1 class="vw-title">${t}</h1>
<p class="dlg-text">${d}</p>
<noscript><p class="dlg-text">This interactive knowledge map needs JavaScript.</p></noscript>
</div></main>
</div>
</body>
</html>
`;
}

/** Neutral landing page for the shares site root: no listing of published maps. */
export function renderSharesIndex() {
  const app = `${CONFIG.pagesOrigin}/${CONFIG.appRepo}/`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Neuron shared maps</title><meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${escapeHtml(app)}">
</head><body><p><a href="${escapeHtml(app)}">Neuron — knowledge graph builder</a></p></body></html>
`;
}
