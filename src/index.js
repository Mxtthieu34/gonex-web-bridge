// src/index.js
// GoNex Web Bridge — Backend con búsqueda robusta

const express = require('express');
const path = require('path');
const { YTubeNoAPI } = require('ytube-noapi');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const publicPath = path.join(__dirname, '..', 'public');
const youtube = new YTubeNoAPI();

app.disable('x-powered-by');
app.set('trust proxy', 1);

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
    "connect-src 'self' https://www.youtube.com https://api.tavily.com https://es.wikipedia.org https://api.openverse.org https://html.duckduckgo.com https://api.duckduckgo.com https://geocoding-api.open-meteo.com https://api.open-meteo.com",
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
async function fetchWithTimeout(url, options = {}, timeout = 8000) {
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

// Scrapea DuckDuckGo HTML (funciona sin API key, casi nunca bloqueado)
async function duckduckgoHTMLSearch(query, limit = 10) {
  const url = 'https://html.duckduckgo.com/html/';
  const body = new URLSearchParams({ q: query });
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    },
    body: body.toString()
  }, 10000);

  if (!res.ok) throw new Error(`DDG HTML: ${res.status}`);
  const html = await res.text();

  const results = [];
  // Parsear resultados con regex simple
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    let url = match[1];
    // DDG redirige con //duckduckgo.com/l/?uddg=... - extraer URL real
    if (url.includes('uddg=')) {
      const m = url.match(/uddg=([^&]+)/);
      if (m) url = decodeURIComponent(m[1]);
    }
    const title = match[2].replace(/<[^>]*>/g, '').trim();
    const snippet = match[3].replace(/<[^>]*>/g, '').trim();
    if (title && url) {
      results.push({ title, url, description: snippet });
    }
  }

  return results;
}

// Wikipedia REST API (más simple y robusta que la MediaWiki API)
async function wikipediaRestSearch(query, limit = 10) {
  const url = `https://es.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'GoNexWebBridge/1.0' }
  }, 8000);

  if (!res.ok) throw new Error(`Wikipedia: ${res.status}`);
  const data = await res.json();

  return (data.pages || []).map(p => ({
    title: p.title,
    url: `https://es.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
    description: p.excerpt ? p.excerpt.replace(/<[^>]*>/g, '') : (p.description || 'Sin descripción')
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
// Búsqueda Web (Tavily → DDG HTML → Wikipedia)
// ==========================================================
app.get('/api/web-search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta "q".' });

  // 1. Tavily (si hay key)
  if (TAVILY_API_KEY) {
    try {
      const r = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query.trim(), max_results: 10 })
      }, 8000);
      if (r.ok) {
        const d = await r.json();
        if (d.results?.length) {
          return res.json({
            results: d.results.map(i => ({ title: i.title, url: i.url, description: i.content || '' })),
            source: 'tavily'
          });
        }
      }
    } catch (e) { console.error('Tavily error:', e.message); }
  }

  // 2. DuckDuckGo HTML scraping
  try {
    const results = await duckduckgoHTMLSearch(query.trim(), 10);
    if (results.length > 0) {
      return res.json({ results, source: 'duckduckgo' });
    }
  } catch (e) { console.error('DDG HTML error:', e.message); }

  // 3. Wikipedia REST
  try {
    const results = await wikipediaRestSearch(query.trim(), 10);
    res.json({ results, source: 'wikipedia' });
  } catch (e) {
    console.error('Wiki REST error:', e.message);
    res.status(500).json({ error: 'No se pudo buscar. Intenta otra consulta.' });
  }
});

// ==========================================================
// Wikipedia
// ==========================================================
app.get('/api/wiki-search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta "q".' });
  try {
    const results = await wikipediaRestSearch(query.trim(), 15);
    res.json({ results });
  } catch (e) {
    console.error('Wiki error:', e.message);
    res.status(500).json({ error: 'Error Wikipedia.' });
  }
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
      8000
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
// Respuestas (DDG Instant + fallback DDG HTML)
// ==========================================================
app.get('/api/instant-search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta "q".' });

  try {
    const r = await fetchWithTimeout(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query.trim())}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'GoNexWebBridge/1.0' } },
      6000
    );
    const d = await r.json();
    const results = [];

    if (d.AbstractText && d.AbstractURL) {
      results.push({ title: d.Heading || query, url: d.AbstractURL, description: d.AbstractText });
    }
    (d.RelatedTopics || []).slice(0, 8).forEach(t => {
      if (t.Text && t.FirstURL) {
        results.push({ title: t.Text.substring(0, 80), url: t.FirstURL, description: t.Text });
      }
    });

    if (results.length > 0) return res.json({ results, source: 'ddg-instant' });

    // Fallback: DDG HTML
    const htmlResults = await duckduckgoHTMLSearch(query.trim(), 8);
    res.json({ results: htmlResults, source: 'duckduckgo' });
  } catch (e) {
    console.error('Instant error:', e.message);
    // Último recurso: DDG HTML
    try {
      const htmlResults = await duckduckgoHTMLSearch(query.trim(), 8);
      return res.json({ results: htmlResults });
    } catch (e2) {
      res.status(500).json({ error: 'Error al buscar respuestas.' });
    }
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