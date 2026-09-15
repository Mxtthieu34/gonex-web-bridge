// src/index.js
// GoNex Web Bridge — Backend Express 5 hardened para Vercel Serverless
// Fase 3: DeepSeek — Ingeniero Backend + Hardening

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const publicPath = path.join(__dirname, '..', 'public');

// ==========================================================
// 0. CONFIGURACIÓN BASE
// ==========================================================
// Oculta la cabecera "X-Powered-By: Express" (information disclosure).
app.disable('x-powered-by');

// Confía en el proxy de Vercel para obtener la IP real del cliente.
app.set('trust proxy', 1);

// ==========================================================
// 1. MIDDLEWARE DE SEGURIDAD (CABECERAS)
// ==========================================================
// Todas las cabeceras se aplican ANTES de cualquier otra lógica.
// Referrer-Policy es CRÍTICA para que YouTube permita el embed (Error 153).
app.use((req, res, next) => {
  // Requerido por YouTube para el reproductor embebido.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Evita MIME sniffing (defensa contra XSS por contenido mal tipado).
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Impide que NUESTRA web sea iframada por terceros (clickjacking).
  // NO afecta a los iframes que NOSOTROS cargamos.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Bloquea APIs sensibles del navegador que no usamos.
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // CSP compatible con el frontend actual (inline CSS/JS) y con YouTube.
  // - script-src: 'self' + 'unsafe-inline' (el index.html lleva <script> embebido).
  // - style-src:  'self' + 'unsafe-inline' + Google Fonts.
  // - frame-src:  YouTube (embed normal y nocookie).
  // - img-src:    permite miniaturas de YouTube (i.ytimg.com) y data URIs.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'"
    ].join('; ')
  );

  next();
});

// ==========================================================
// 2. PARSERS DE BODY (PREPARACIÓN PARA APIs FUTURAS)
// ==========================================================
// Límites conservadores para prevenir payloads abusivos en serverless.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ==========================================================
// 3. ARCHIVOS ESTÁTICOS
// ==========================================================
app.use(
  express.static(publicPath, {
    // Los assets estáticos se cachean fuerte; el HTML no.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    }
  })
);

// ==========================================================
// 4. RUTA WILDCARD (SPA FALLBACK) — EXPRESS 5
// ==========================================================
// Sintaxis correcta en Express 5: '/{*splat}'.
// Solo sirve index.html si el cliente acepta HTML. Para el resto, 404.
app.get('/{*splat}', (req, res, next) => {
  if (!req.accepts('html')) {
    return next(); // deja pasar al 404 handler
  }

  res.sendFile('index.html', { root: publicPath }, (err) => {
    if (err) next(err);
  });
});

// ==========================================================
// 5. MANEJADOR 404
// ==========================================================
app.use((req, res) => {
  if (req.accepts('html')) {
    return res
      .status(404)
      .send('<!doctype html><meta charset="utf-8"><title>404</title><h1>404 — No encontrado</h1>');
  }
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// ==========================================================
// 6. MANEJADOR GLOBAL DE ERRORES (4 argumentos)
// ==========================================================
// Express 5 maneja rechazos de promesas automáticamente y los
// redirige aquí, así que las rutas async ya están cubiertas.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isServerError = status >= 500;

  // Log siempre en consola (Vercel lo captura en su dashboard).
  if (isServerError) {
    console.error('[GoNex Error]', {
      status,
      message: err.message,
      path: req.originalUrl,
      method: req.method,
      stack: IS_PROD ? undefined : err.stack
    });
  }

  // No filtrar detalles internos al cliente en producción.
  const clientMessage = IS_PROD && isServerError ? 'Error interno del servidor' : err.message;

  if (req.accepts('html')) {
    return res
      .status(status)
      .send(
        `<!doctype html><meta charset="utf-8"><title>${status}</title>` +
          `<h1>${status}</h1><p>${clientMessage}</p>`
      );
  }

  res.status(status).json({
    error: status === 500 ? 'Internal Server Error' : err.name || 'Error',
    message: clientMessage
  });
});

// ==========================================================
// 7. INICIALIZACIÓN CONDICIONAL (SOLO DESARROLLO LOCAL)
// ==========================================================
// En Vercel (NODE_ENV=production) NO se llama a app.listen().
// Vercel importa el módulo y maneja las peticiones internamente.
if (!IS_PROD) {
  app.listen(PORT, () => {
    console.log(`GoNex Web Bridge (dev) activo en http://localhost:${PORT}`);
  });
}

// ==========================================================
// 8. EXPORTACIÓN SERVERLESS (OBLIGATORIA PARA VERCEL)
// ==========================================================
module.exports = app;