// src/index.js
// GoNex Web Bridge - Backend Express 5 con Proxy Inverso

const express = require('express');
const path = require('path');
const { YTubeNoAPI } = require('ytube-noapi');
const cheerio = require('cheerio');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const publicPath = path.join(__dirname, '..', 'public');
const youtube = new YTubeNoAPI();

// --- Configuración base ---
app.disable('x-powered-by');
app.set('trust proxy', 1);

// --- Middleware de seguridad (para nuestra propia web) ---
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
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
      "connect-src 'self' https://www.youtube.com https://api.tavily.com",
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

// ==========================================================
// ENDPOINT: Búsqueda en YouTube
// ==========================================================
app.get('/api/youtube-search', async (req, res) => {
  const query = req.query.q;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro "q".' });
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
    console.error('[GoNex] Error /api/youtube-search:', error.message);
    res.status(500).json({ error: 'Error al buscar en YouTube.' });
  }
});

// ==========================================================
// ENDPOINT: Búsqueda Web con Tavily
// ==========================================================
app.get('/api/web-search', async (req, res) => {
  const query = req.query.q;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro "q".' });
  }

  if (!TAVILY_API_KEY) {
    console.error('[GoNex] TAVILY_API_KEY no configurada.');
    return res.status(500).json({ error: 'El servicio de búsqueda web no está configurado.' });
  }

  try {
    const apiResponse = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query.trim(),
        search_depth: 'basic',
        max_results: 10,
        include_answer: false,
        include_images: false
      })
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error('[GoNex] Tavily error:', apiResponse.status, errText);
      throw new Error(`Tavily respondió con estado ${apiResponse.status}`);
    }

    const data = await apiResponse.json();

    const results = (data.results || []).map((item) => ({
      title: item.title || 'Sin título',
      url: item.url || '',
      description: item.content || ''
    }));

    res.status(200).json({ results });
  } catch (error) {
    console.error('[GoNex] Error /api/web-search:', error.message);
    res.status(500).json({ error: 'Error al buscar en la web.' });
  }
});

// ==========================================================
// ENDPOINT: Proxy Inverso para el Visor Web
// ==========================================================
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).send('Falta el parámetro "url".');
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });

    // Eliminamos las cabeceras que bloquean la incrustación en iframes
    const headers = new Headers(response.headers);
    headers.delete('x-frame-options');
    headers.delete('content-security-policy');
    headers.delete('content-security-policy-report-only');
    headers.delete('x-content-type-options');

    // Forzamos que el navegador no cachee y permita la visualización
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Frame-Options', 'ALLOWALL');

    const contentType = headers.get('content-type') || '';

    // Si es HTML, reescribimos las URLs para que pasen por nuestro proxy
    if (contentType.includes('text/html')) {
      let html = await response.text();
      const $ = cheerio.load(html);

      // Reescribimos todos los enlaces <a>
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            const absoluteUrl = new URL(href, targetUrl).href;
            $(el).attr('href', `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`);
            $(el).attr('target', '_self');
          } catch (e) { /* Ignorar URLs inválidas */ }
        }
      });

      // Reescribimos los recursos (CSS, JS, imágenes)
      $('link[rel="stylesheet"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, targetUrl).href;
            $(el).attr('href', `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {}
        }
      });

      $('script[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (src) {
          try {
            const absoluteUrl = new URL(src, targetUrl).href;
            $(el).attr('src', `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {}
        }
      });

      $('img[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (src) {
          try {
            const absoluteUrl = new URL(src, targetUrl).href;
            $(el).attr('src', `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {}
        }
      });

      // Reescribimos los formularios
      $('form').each((i, el) => {
        const action = $(el).attr('action');
        if (action) {
          try {
            const absoluteUrl = new URL(action, targetUrl).href;
            $(el).attr('action', `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {}
        }
      });

      // Inyectamos un pequeño script para que los enlaces se abran en el iframe
      $('head').append(`
        <base target="_self">
        <style>
          a, form, button { cursor: pointer !important; }
        </style>
      `);

      html = $.html();

      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } else {
      // Para otros recursos (CSS, JS, imágenes), los servimos tal cual
      const buffer = await response.arrayBuffer();
      res.set(headers);
      res.send(Buffer.from(buffer));
    }

  } catch (error) {
    console.error('[GoNex] Error en /api/proxy:', error.message);
    res.status(500).send('Error al cargar la página a través del proxy.');
  }
});

// ==========================================================
// RUTA WILDCARD (SPA) — Express 5
// ==========================================================
app.get('/{*splat}', (req, res, next) => {
  if (!req.accepts('html')) {
    return next();
  }

  res.sendFile('index.html', { root: publicPath }, (err) => {
    if (err) next(err);
  });
});

// ==========================================================
// 404
// ==========================================================
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

// ==========================================================
// MANEJADOR GLOBAL DE ERRORES
// ==========================================================
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

// ==========================================================
// INICIALIZACIÓN CONDICIONAL
// ==========================================================
if (!IS_PROD) {
  app.listen(PORT, () => {
    console.log(`GoNex Web Bridge (dev) en http://localhost:${PORT}`);
  });
}

// ==========================================================
// EXPORTACIÓN SERVERLESS
// ==========================================================
module.exports = app;