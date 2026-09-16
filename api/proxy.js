/* ==========================================
 *api/proxy.js - GoNex Web Bridge Proxy (LA MEJOR LÓGICA DE BACKEND)
 * ==========================================
 * Esta función Serverless de Vercel intercepta peticiones web,
 * realiza la petición en secreto y devuelve el contenido
 * eliminando las cabeceras de seguridad restrictivas.
 */

// Usamos node-fetch incorporado en el entorno de Vercel Node.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  // 1. Extraer la URL de destino desde la query string
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send("No se ha proporcionado una URL de destino.");
  }

  try {
    // 2. Realizar la petición web Server-Side
    const response = await fetch(targetUrl);

    // 3. LA CLAVE DEL ÉXITO: Auditar y Limpiar Cabeceras
    const contentType = response.headers.get("content-type") || "text/html";
    const body = await response.text();

    // 4. Configurar las nuevas cabeceras de respuesta para tu Iframe
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Frame-Options", "ALLOWALL"); // ¡Permitir inserción total!
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"); // CSP más relajada
    res.setHeader("Access-Control-Allow-Origin", "*"); // CORS laxo para peticiones internas

    // 5. Devolver el contenido limpio
    res.status(200).send(body);

  } catch (error) {
    // Manejo de errores
    console.error(`Proxy Error al cargar ${targetUrl}:`, error);
    res.status(500).send(`Error al intentar cargar el sitio web: ${error.message}`);
  }
}