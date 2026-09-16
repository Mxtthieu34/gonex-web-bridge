// src/index.js
// GoNex Web Bridge - Backend Express 5 + Búsqueda de YouTube sin API Key.

const express = require('express');
const path = require('path');
const { YTubeNoAPI } = require('ytube-noapi');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const publicPath = path.join(__dirname, '..', 'public');
const youtube = new YTubeNoAPI();

// --- Configuración base ---
app.disable('x-powered-by');
app.set('trust proxy', 1);

// --- Middleware de seguridad ---
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // CSP: se permite cargar el script de la API IFrame de YouTube
  // (https://www.youtube.com/iframe_api) y los iframes de YouTube.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
      "connect-src 'self' https://www.youtube.com https://www.google.com",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'"
    ].join('; ')
  );

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  next();
});

// --- Parsers de body ---
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// --- Archivos estáticos ---
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

// --- Endpoint de búsqueda en YouTube ---
app.get('/api/youtube-search', async (req, res) => {
  const query = req.query.q;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro de búsqueda "q".' });
  }

  try {
    const videos = await youtube.searchVideos(query.trim(), 12);

    if (!videos || videos.length === 0) {
      return res.status(200).json({ results: [] });
    }

    const results = videos.map((video) => ({
      videoId: video.videoId,
      title: video.title,
      thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
      channelTitle: video.channelTitle || video.channel || 'Canal desconocido',
      publishedAt: video.publishedAt || ''
    }));

    res.status(200).json({ results });
  } catch (error) {
    console.error('[GoNex] Error en /api/youtube-search:', error.message);
    res.status(500).json({ error: 'Error interno del servidor al buscar en YouTube.' });
  }
});

// --- Wildcard SPA (Express 5) ---
app.get('/{*splat}', (req, res, next) => {
  if (!req.accepts('html')) {
    return next();
  }

  res.sendFile('index.html', { root: publicPath }, (err) => {
    if (err) next(err);
  });
});

// --- 404 ---
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).send(
      '<!doctype html><meta charset="utf-8"><title>404</title>' +
      '<body style="font-family:system-ui;background:#0b0f19;color:#f1f5f9;padding:40px;">' +
      '<h1>404 - No encontrado</h1>' +
      '<a href="/" style="color:#a855f7;">Volver al inicio</a></body>'
    );
  }
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// --- Manejador global de errores ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isServerError = status >= 500;

  if (isServerError) {
    console.error('[GoNex Error]', {
      status,
      message: err.message,
      path: req.originalUrl,
      method: req.method
    });
  }

  if (res.headersSent) {
    return next(err);
  }

  const clientMessage = IS_PROD && isServerError ? 'Error interno del servidor' : err.message;

  if (req.accepts('html')) {
    return res.status(status).send(
      `<!doctype html><meta charset="utf-8"><title>${status}</title>` +
      '<body style="font-family:system-ui;background:#0b0f19;color:#f1f5f9;padding:40px;">' +
      `<h1>${status}</h1><p>${clientMessage}</p>` +
      '<a href="/" style="color:#a855f7;">Volver al inicio</a></body>'
    );
  }

  res.status(status).json({
    error: status === 500 ? 'Internal Server Error' : err.name || 'Error',
    message: clientMessage
  });
});

// --- Inicialización condicional ---
if (!IS_PROD) {
  app.listen(PORT, () => {
    console.log(`GoNex Web Bridge (dev) en http://localhost:${PORT}`);
  });
}

// --- Exportación serverless ---
module.exports = app;