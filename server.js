import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const publicDirectory = fileURLToPath(new URL('./src/public/', import.meta.url));
const omittedHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'accept-encoding']);
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export function createApp({ timeout = 30000, maxResponseBytes = 5 * 1024 * 1024 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.get('host') || '')) return res.status(403).json({ error: 'Access this local tool through localhost or 127.0.0.1.' });
    next();
  });
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Cross-origin proxy requests are not allowed.' });
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.post('/api/proxy', async (req, res) => {
    const input = req.body;
    if (!input || typeof input.url !== 'string' || typeof input.method !== 'string' || !methods.has(input.method)) return res.status(400).json({ error: 'Provide a URL and a supported HTTP method.' });
    let target;
    try { target = new URL(input.url); } catch { return res.status(400).json({ error: 'Invalid target URL.' }); }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return res.status(400).json({ error: 'Use an HTTP(S) URL without embedded credentials.' });
    if (input.body !== undefined && typeof input.body !== 'string') return res.status(400).json({ error: 'Request body must be text.' });
    if (['GET', 'HEAD'].includes(input.method) && input.body !== undefined) return res.status(400).json({ error: `${input.method} requests cannot have a body.` });
    if (!Array.isArray(input.headers) || input.headers.length > 200) return res.status(400).json({ error: 'Provide up to 200 headers as key/value rows.' });
    const headers = new Headers();
    const skippedHeaders = [];
    try {
      const connectionTokens = input.headers.filter(row => row && typeof row.key === 'string' && row.key.toLowerCase() === 'connection').flatMap(row => String(row.value).toLowerCase().split(',').map(value => value.trim()));
      for (const row of input.headers) {
        if (!row || typeof row.key !== 'string' || typeof row.value !== 'string' || !/^[!#$%&'*+.^_`|~\da-zA-Z-]+$/.test(row.key) || /[\r\n\0]/.test(row.value)) throw new Error('Invalid header');
        if (omittedHeaders.has(row.key.toLowerCase()) || connectionTokens.includes(row.key.toLowerCase())) { skippedHeaders.push(row.key); continue; }
        headers.append(row.key, row.value);
      }
    } catch { return res.status(400).json({ error: 'Invalid header name or value.' }); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    const started = performance.now();
    try {
      const upstream = await fetch(target, { method: input.method, headers, ...(input.body !== undefined ? { body: input.body } : {}), signal: controller.signal, redirect: 'manual' });
      const chunks = [];
      let size = 0;
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          size += chunk.byteLength;
          if (size > maxResponseBytes) { controller.abort(); return res.status(413).json({ error: 'Response exceeds the 5 MB preview limit.' }); }
          chunks.push(Buffer.from(chunk));
        }
      }
      res.json({ status: upstream.status, statusText: upstream.statusText, duration: Math.round(performance.now() - started), headers: [...upstream.headers].map(([key, value]) => ({ key, value })), body: Buffer.concat(chunks).toString('utf8'), size, skippedHeaders });
    } catch (error) {
      if (!res.destroyed && !res.headersSent) res.status(controller.signal.aborted ? 504 : 502).json({ error: controller.signal.aborted ? 'Request timed out or was cancelled.' : `Could not reach the target: ${error.cause?.message || error.message}` });
    } finally { clearTimeout(timer); res.off('close', onClose); }
  });
  app.use(express.static(publicDirectory));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status === 413 ? 413 : 400).json({ error: error.status === 413 ? 'Request exceeds the 2 MB input limit.' : 'Invalid JSON request.' });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, '127.0.0.1', () => console.log(`cURL Workbench is ready at http://127.0.0.1:${port}`));
}
