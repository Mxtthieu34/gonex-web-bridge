// src/index.js
// GoNex Web Bridge — Backend con múltiples motores de búsqueda

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

// ==========================================================
// MIDDLEWARE DE SEGURIDAD
// ==========================================================
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://www.canva.com",
      "connect-src 'self' https://www.youtube.com https://api.tavily.com https://es.wikipedia.org https://api.openverse.org https://api.duckduckgo.com https://geocoding-api.open-meteo.com https://api.open-meteo.com",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'"
    ].join('; ')
  );

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(
  express.static(publicPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      }
    },
    dotfiles: 'ignore'
  })
);

// ==========================================================
// 1. YouTube Search
// ==========================================================
app.get('/api/youtube-search', async (req, res) => {
  const query = req.query.q;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro "q".' });
  }
  try {
    const videos = await youtube.searchVideos(query.trim(), 12);
    if (!videos || videos.length === 0) return res.status(200).json({ results: [] });
    const results = videos.map((video) => ({
      videoId: video.videoId,
      title: video.title,
      thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
      channelTitle: video.channelTitle || video.channel || 'Canal desconocido'
    }));
    res.status(200).json({ results });
  } catch (error) {
    console.error('[GoNex] YouTube error:', error.message);
    res.status(500).json({ error: 'Error al buscar en YouTube.' });
  }
});

// ==========================================================
// 2. Búsqueda Web con Tavily (con fallback a Wikipedia)
// ==========================================================
app.get('/api/web-search', async (req, res) => {
  const query = req.query.q;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro "q".' });
  }

  // Intento 1: Tavily (si hay clave)
  if (TAVILY_API_KEY) {
    try {
      const apiResponse = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query: query.trim(),
          search_depth: 'basic',
          max_results: 10
        })
      });
      if (apiResponse.ok) {
        const data = await apiResponse.json();
        const results = (data.results || []).map((item) => ({
          title: item.title || 'Sin título',
          url: item.url || '',
          description: item.content || ''
        }));
        return res.status(200).json({ results, source: 'tavily' });
      }
    } catch (e) {
      console.error('[GoNex] Tavily falló, usando Wikipedia:', e.message);
    }
  }

  // Fallback: Wikipedia
  try {
    const wikiUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query.trim())}&format=json&origin=*&srlimit=10`;
    const wikiRes = await fetch(wikiUrl);
    const wikiData = await wikiRes.json();
    const results = (wikiData.query?.search || []).map((item) => ({
      title: item.title,
      url: `https://es.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
      description: item.snippet ? item.snippet.replace(/<[^>]*>/g, '') : ''
    }));
    res.status(200).json({ results, source: 'wikipedia' });
  } catch (error) {
    console.error('[GoNex] Wikipedia fallback error:', error.message);
    res.status(500).json({ error: 'Error al buscar en la web.' });
  }
});

// ==========================================================
// 3. Wikipedia Search
// ==========================================================
app.get('/api/wiki-search', async (req, res) => {
  const query = req.query.q;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro "q".' });
  }
  try {
    const wikiUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query.trim())}&format=json&origin=*&srlimit=15`;
    const wikiRes = await fetch(wikiUrl);
    const wikiData = await wikiRes.json();
    const results = (wikiData.query?.search || []).map((item) => ({
      title: item.title,
      url: `https://es.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
      description: item.snippet ? item.snippet.replace(/<[^>]*>/g, '') : '',
      wordcount: item.wordcount || 0
    }));
    res.status(200).json({ results });
  } catch (error) {
    console.error('[GoNex] Wikipedia error:', error.message);
    res.status(500).json({ error: 'Error al buscar en Wikipedia.' });
  }
});

// ==========================================================
// 4. Búsqueda de Imágenes (OpenVerse, sin clave)
// ==========================================================
app.get('/api/image-search', async (req, res) => {
  const query = req.query.q;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro "q".' });
  }
  try {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query.trim())}&page_size=12`;
    const apiRes = await fetch(url, {
      headers: { 'User-Agent': 'GoNex-Web-Bridge/1.0' }
    });
    if (!apiRes.ok) throw new Error(`OpenVerse: ${apiRes.status}`);
    const data = await apiRes.json();
    const results = (data.results || []).map((item) => ({
      title: item.title || 'Sin título',
      thumbnail: item.thumbnail || item.url,
      url: item.url,
      creator: item.creator || 'Desconocido',
      license: item.license || ''
    }));
    res.status(200).json({ results });
  } catch (error) {
    console.error('[GoNex] OpenVerse error:', error.message);
    res.status(500).json({ error: 'Error al buscar imágenes.' });
  }
});

// ==========================================================
// 5. Respuestas rápidas (DuckDuckGo Instant Answer)
// ==========================================================
app.get('/api/instant-search', async (req, res) => {
  const query = req.query.q;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro "q".' });
  }
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query.trim())}&format=json&no_html=1&skip_disambig=1`;
    const apiRes = await fetch(url);
    const data = await apiRes.json();

    const results = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        description: data.AbstractText,
        type: 'abstract'
      });
    }
    (data.RelatedTopics || []).slice(0, 8).forEach((topic) => {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.substring(0, 80),
          url: topic.FirstURL,
          description: topic.Text,
          type: 'related'
        });
      }
    });

    res.status(200).json({ results });
  } catch (error) {
    console.error('[GoNex] DDG error:', error.message);
    res.status(500).json({ error: 'Error al buscar respuestas.' });
  }
});

// ==========================================================
// RUTA WILDCARD SPA
// ==========================================================
app.get('/{*splat}', (req, res, next) => {
  if (!req.accepts('html')) return next();
  res.sendFile('index.html', { root: publicPath }, (err) => {
    if (err) next(err);
  });
});

app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).send('<!doctype html><meta charset="utf-8"><title>404</title><h1>404</h1>');
  }
  res.status(404).json({ error: 'Not Found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error('[GoNex Error]', { status, message: err.message, path: req.originalUrl });
  if (res.headersSent) return next(err);
  const clientMessage = IS_PROD && status >= 500 ? 'Error interno' : err.message;
  if (req.accepts('html')) {
    return res.status(status).send(`<!doctype html><meta charset="utf-8"><h1>${status}</h1><p>${clientMessage}</p>`);
  }
  res.status(status).json({ error: err.name || 'Error', message: clientMessage });
});

if (!IS_PROD) {
  app.listen(PORT, () => console.log(`GoNex (dev) en http://localhost:${PORT}`));
}

module.exports = app;