// src/index.js
// GoNex Web Bridge — Backend con Firecrawl Keyless + Keenable

const express = require('express');
const path = require('path');
const { YTubeNoAPI } = require('ytube-noapi');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const publicPath = path.join(__dirname, '..', 'public');
const youtube = new YTubeNoAPI();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ==========================================================
// MIDDLEWARE DE SEGURIDAD
// ==========================================================
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://www.canva.com",
    "connect-src 'self' https://www.youtube.com https://api.firecrawl.dev https://api.keenable.ai https://api.openverse.org https://geocoding-api.open-meteo.com https://api.open-meteo.com",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; '));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(express.static(publicPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    else res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  },
  dotfiles: 'ignore'
}));

// ==========================================================
// HELPERS
// ==========================================================
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ==========================================================
// FIRECRAWL KEYLESS SEARCH
// ==========================================================
async function firecrawlSearch(query, limit = 10) {
  const res = await fetchWithTimeout('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: query,
      limit: limit,
      sources: ['web']
    })
  }, 12000);

  if (!res.ok) throw new Error(`Firecrawl: ${res.status}`);
  const data = await res.json();

  return (data.data || []).map(item => ({
    title: item.title || 'Sin título',
    url: item.url || '',
    description: item.description || item.markdown?.substring(0, 200) || ''
  }));
}

// ==========================================================
// KEENABLE KEYLESS SEARCH
// ==========================================================
async function keenableSearch(query, limit = 10) {
  const res = await fetchWithTimeout('https://api.keenable.ai/v1/search/public', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Keenable-Title': 'GoNexWebBridge'
    },
    body: JSON.stringify({ query: query, max_results: limit })
  }, 10000);

  if (!res.ok) throw new Error(`Keenable: ${res.status}`);
  const data = await res.json();

  return (data.results || []).map(item => ({
    title: item.title || 'Sin título',
    url: item.url || '',
    description: item.snippet || item.description || ''
  }));
}

// ==========================================================
// YouTube
// ==========================================================
app.get('/api/youtube-search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta "q".' });
  try {
    const videos = await youtube.searchVideos(query.trim(), 12);
    if (!videos?.length) return res.json({ results: [] });
    res.json({
      results: videos.map(v => ({
        videoId: v.videoId,
        title: v.title,
        thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        channelTitle: v.channelTitle || v.channel || 'Canal'
      }))
    });
  } catch (e) {
    console.error('YT error:', e.message);
    res.status(500).json({ error: 'Error YouTube.' });
  }
});

// ==========================================================
// Búsqueda Web (Firecrawl → Keenable → OpenVerse)
// ==========================================================
app.get('/api/web-search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta "q".' });

  // 1. Firecrawl Keyless
  try {
    const results = await firecrawlSearch(query.trim(), 10);
    if (results.length > 0) {
      return res.json({ results, source: 'firecrawl' });
    }
  } catch (e) { console.error('Firecrawl error:', e.message); }

  // 2. Keenable Keyless
  try {
    const results = await keenableSearch(query.trim(), 10);
    if (results.length > 0) {
      return res.json({ results, source: 'keenable' });
    }
  } catch (e) { console.error('Keenable error:', e.message); }

  // 3. OpenVerse como último recurso (imágenes)
  try {
    const r = await fetchWithTimeout(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query.trim())}&page_size=8`,
      { headers: { 'User-Agent': 'GoNexWebBridge/1.0' } },
      8000
    );
    if (r.ok) {
      const d = await r.json();
      const results = (d.results || []).map(i => ({
        title: i.title || 'Sin título',
        url: i.url || '',
        description: `📷 ${i.creator || 'Desconocido'}${i.license ? ' · ' + i.license : ''}`
      }));
      if (results.length > 0) return res.json({ results, source: 'openverse' });
    }
  } catch (e) { console.error('OpenVerse error:', e.message); }

  res.status(500).json({ error: 'No se pudo buscar. Intenta otra consulta.' });
});

// ==========================================================
// Imágenes (OpenVerse)
// ==========================================================
app.get('/api/image-search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta "q".' });
  try {
    const r = await fetchWithTimeout(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query.trim())}&page_size=12`,
      { headers: { 'User-Agent': 'GoNexWebBridge/1.0' } },
      10000
    );
    if (!r.ok) throw new Error(`OpenVerse: ${r.status}`);
    const d = await r.json();
    res.json({
      results: (d.results || []).map(i => ({
        title: i.title || 'Sin título',
        thumbnail: i.thumbnail || i.url,
        url: i.url,
        creator: i.creator || 'Desconocido',
        license: i.license || ''
      }))
    });
  } catch (e) {
    console.error('OpenVerse error:', e.message);
    res.status(500).json({ error: 'Error imágenes.' });
  }
});

// ==========================================================
// Respuestas rápidas (Firecrawl + filtro)
// ==========================================================
app.get('/api/instant-search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta "q".' });

  try {
    const results = await firecrawlSearch(query.trim(), 6);
    if (results.length > 0) {
      return res.json({ results, source: 'firecrawl' });
    }
  } catch (e) { console.error('Firecrawl instant error:', e.message); }

  // Fallback: Keenable
  try {
    const results = await keenableSearch(query.trim(), 6);
    res.json({ results, source: 'keenable' });
  } catch (e) {
    console.error('Keenable instant error:', e.message);
    res.status(500).json({ error: 'Error al buscar respuestas.' });
  }
});

// ==========================================================
// WILDCARD SPA
// ==========================================================
app.get('/{*splat}', (req, res, next) => {
  if (!req.accepts('html')) return next();
  res.sendFile('index.html', { root: publicPath }, (err) => { if (err) next(err); });
});

app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error('[GoNex Error]', { status, message: err.message, path: req.originalUrl });
  if (res.headersSent) return next(err);
  res.status(status).json({ error: 'Error interno', message: err.message });
});

if (!IS_PROD) {
  app.listen(PORT, () => console.log(`GoNex (dev) en http://localhost:${PORT}`));
}

module.exports = app;