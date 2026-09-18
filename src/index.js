// src/index.js
// GoNex Web Bridge — Backend con Steel.dev (audio habilitado, timeout 15 min)

const express = require('express');
const path = require('path');
const { YTubeNoAPI } = require('ytube-noapi');
const Steel = require('steel-sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const publicPath = path.join(__dirname, '..', 'public');
const youtube = new YTubeNoAPI();

const steel = process.env.STEEL_API_KEY
  ? new Steel({ steelAPIKey: process.env.STEEL_API_KEY })
  : null;

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
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://www.canva.com https://*.steel.dev",
    "connect-src 'self' https://www.youtube.com https://api.steel.dev https://api.openverse.org https://geocoding-api.open-meteo.com https://api.open-meteo.com",
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
// 1. YouTube Search
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
// 2. Imágenes (OpenVerse)
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
// 3. Listar sesiones activas (diagnóstico)
// ==========================================================
app.get('/api/browser-sessions', async (req, res) => {
  if (!steel) return res.status(500).json({ error: 'STEEL_API_KEY no configurada.' });
  try {
    const sessions = await steel.sessions.list();
    res.json({ sessions });
  } catch (e) {
    console.error('[Steel] Error listando:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ==========================================================
// 4. Limpiar TODAS las sesiones huérfanas
// ==========================================================
app.post('/api/browser-sessions/cleanup', async (req, res) => {
  if (!steel) return res.status(500).json({ error: 'STEEL_API_KEY no configurada.' });
  try {
    const list = await steel.sessions.list();
    const sessions = list.sessions || list || [];
    let released = 0;
    for (const s of sessions) {
      try {
        await steel.sessions.release(s.id);
        released++;
      } catch (e) {
        console.warn('[Steel] No se pudo liberar', s.id, e.message);
      }
    }
    res.json({ released, total: sessions.length });
  } catch (e) {
    console.error('[Steel] Error limpiando:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ==========================================================
// 5. Crear sesión de navegador en la nube
// ✅ CON AUDIO HABILITADO
// ✅ Timeout 15 min (plan gratuito)
// ==========================================================
app.post('/api/browser-session', async (req, res) => {
  if (!steel) {
    return res.status(500).json({ error: 'STEEL_API_KEY no configurada.' });
  }

  const { url } = req.body || {};
  const startUrl = url && url.startsWith('http') ? url : 'https://www.google.com';

  try {
    const session = await steel.sessions.create({
      url: startUrl,
      timeout: 900000,            // 15 minutos (máximo del plan gratuito)
      inactivityTimeout: 300000,  // 5 minutos
      // ✅ Habilita el audio del navegador remoto
      'steel.browser.args': [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=AudioServiceOutOfProcess',
        '--enable-features=WebRtcAllowInputVolumeAdjustment',
        '--alsa-output-device=default'
      ]
    });

    console.log('[Steel] Sesión creada:', session.id, '→', startUrl);
    res.json({
      sessionId: session.id,
      debugUrl: session.debugUrl,
      sessionViewerUrl: session.sessionViewerUrl
    });
  } catch (e) {
    // Si falla con args, intentar sin ellos (fallback)
    console.warn('[Steel] Error con args de audio, reintentando sin ellos:', e.message);

    try {
      const session = await steel.sessions.create({
        url: startUrl,
        timeout: 900000,
        inactivityTimeout: 300000
      });
      console.log('[Steel] Sesión creada (sin audio args):', session.id, '→', startUrl);
      res.json({
        sessionId: session.id,
        debugUrl: session.debugUrl,
        sessionViewerUrl: session.sessionViewerUrl
      });
    } catch (e2) {
      console.error('[Steel] Error detallado:', {
        message: e2.message,
        status: e2.status,
        name: e2.name,
        error: e2.error,
        response: e2.response?.data || e2.response?.body || null
      });
      res.status(500).json({
        error: 'No se pudo crear el navegador en la nube.',
        detail: e2.message,
        status: e2.status || null
      });
    }
  }
});

// ==========================================================
// 6. Cerrar sesión de navegador
// ==========================================================
app.post('/api/browser-session/close', async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'Falta sessionId.' });
  try {
    await steel.sessions.release(sessionId);
    console.log('[Steel] Sesión cerrada:', sessionId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Steel] Error cerrando sesión:', e.message);
    res.status(500).json({ error: 'Error cerrando sesión.' });
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