// src/index.js
// GoNex Web Bridge — Backend Express 5 optimizado para Vercel Serverless
// Fase 3: DeepSeek — Auditoría + Optimización

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const publicPath = path.join(__dirname, '..', 'public');

// ==========================================================
// 0. CONFIGURACIÓN BASE
// ==========================================================
// Oculta "X-Powered-By: Express" (information disclosure).
app.disable('x-powered-by');

// Confía en el proxy de Vercel para obtener la IP real del cliente.
app.set('trust proxy', 1);

// ==========================================================
// 1. MIDDLEWARE DE SEGURIDAD + POLÍTICA DE CACHÉ
// ==========================================================
// Todas las cabeceras se aplican ANTES de cualquier otra lógica.
// Referrer-Policy es CRÍTICA para que YouTube permita el embed (Error 153).
app.use((req, res, next) => {
  // --- Seguridad ---
  // Requerido por YouTube para el reproductor embebido.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Evita MIME sniffing (defensa contra XSS por contenido mal tipado).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Impide que NUESTRA web sea iframada por terceros (clickjacking).
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Bloquea APIs sensibles del navegador que no usamos.
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // CSP compatible con el frontend de ChatGPT (inline CSS/JS) y con YouTube.
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

  // --- Política de caché por defecto ---
  // Evita que proxies intermedios (CDN de Vercel incluido) cacheen respuestas
  // dinámicas. Los assets estáticos sobrescriben esta cabecera más abajo.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  next();
});

// ==========================================================
// 2. PARSERS DE BODY (PREPARACIÓN PARA APIs FUTURAS)
// ==========================================================
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ==========================================================
// 3. ARCHIVOS ESTÁTICOS
// ==========================================================
app.use(
  express.static(publicPath, {
    // Los assets estáticos se cachean fuerte; el HTML nunca se cachea.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        // El HTML siempre debe venir fresco (contiene la app y sus rutas).
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        // CSS, JS, imágenes: caché agresiva de 1 día.
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      }
    },
    // No servir dotfiles (evita exponer .env, .git, etc. si por error se suben).
    dotfiles: 'ignore'
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
      .send(
        '<!doctype html><meta charset="utf-8"><title>404 — GoNex</title>' +
          '<body style="font-family:system-ui;background:#0b0f19;color:#f1f5f9;padding:40px;">' +
          '<h1>404 — Ruta no encontrada</h1>' +
          '<p>La página solicitada no existe en GoNex Web Bridge.</p>' +
          '<a href="/" style="color:#a855f7;">Volver al inicio</a>' +
          '</body>'
      );
  }
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// ==========================================================
// 6. MANEJADOR GLOBAL DE ERRORES (4 argumentos)
// ==========================================================
// Express 5 redirige aquí también los rechazos de promesas de rutas async.
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

  // Si los headers ya se enviaron, delegar a Express.
  if (res.headersSent) {
    return next(err);
  }

  if (req.accepts('html')) {
    return res
      .status(status)
      .send(
        `<!doctype html><meta charset="utf-8"><title>${status} — GoNex</title>` +
          '<body style="font-family:system-ui;background:#0b0f19;color:#f1f5f9;padding:40px;">' +
          `<h1>${status}</h1><p>${clientMessage}</p>` +
          '<a href="/" style="color:#a855f7;">Volver al inicio</a>' +
          '</body>'
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