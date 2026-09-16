// src/index.js
// GoNex Web Bridge - Backend Express 5 final (sin proxy)

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
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://www.canva.com",
      "connect-src 'self' https://www.youtube.com https://api.tavily.com",
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
// ENDPOINT: YouTube Search
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
// ENDPOINT: Tavily Web Search
// ==========================================================
app.get('/api/web-search', async (req, res) => {
  const query = req.query.q;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro "q".' });
  }
  if (!TAVILY_API_KEY) {
    return res.status(500).json({ error: 'TAVILY_API_KEY no configurada.' });
  }
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
    if (!apiResponse.ok) throw new Error(`Tavily: ${apiResponse.status}`);
    const data = await apiResponse.json();
    const results = (data.results || []).map((item) => ({
      title: item.title || 'Sin título',
      url: item.url || '',
      description: item.content || ''
    }));
    res.status(200).json({ results });
  } catch (error) {
    console.error('[GoNex] Tavily error:', error.message);
    res.status(500).json({ error: 'Error al buscar en la web.' });
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
  const clientMessage = IS_PROD && status >= 500 ? 'Error interno del servidor' : err.message;
  if (req.accepts('html')) {
    return res.status(status).send(`<!doctype html><meta charset="utf-8"><h1>${status}</h1><p>${clientMessage}</p>`);
  }
  res.status(status).json({ error: err.name || 'Error', message: clientMessage });
});

if (!IS_PROD) {
  app.listen(PORT, () => console.log(`GoNex (dev) en http://localhost:${PORT}`));
}

module.exports = app;