import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.js';

async function serve(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

test('proxy executes requests, preserves errors/redirects, validates input, and bounds resources', async t => {
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/slow') { setTimeout(() => res.end('late'), 150).unref(); return; }
    if (req.url === '/large') { res.end('x'.repeat(2048)); return; }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/echo' }); res.end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    res.writeHead(req.url === '/error' ? 422 : 200, { 'Content-Type': 'application/json', 'X-Upstream': 'yes' });
    res.end(JSON.stringify({ method: req.method, url: req.url, body, testHeader: req.headers['x-test'], cookie: req.headers.cookie }));
  });
  const target = await serve(upstream);
  const proxy = http.createServer(createApp({ timeout: 80, maxResponseBytes: 1024 }));
  const base = await serve(proxy);
  const send = async (data, extraHeaders = {}) => {
    const result = await fetch(base + '/api/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(data) });
    return { status: result.status, data: await result.json() };
  };
  const payload = { url: target + '/echo?a=1&a=2', method: 'POST', headers: [{ key: 'X-Test', value: 'hello' }, { key: 'Cookie', value: 'session=test' }, { key: 'Host', value: 'wrong.test' }, { key: 'Content-Length', value: '1' }], body: '{"hello":"world"}' };
  try {
    await t.test('serves the actual frontend and modules', async () => {
      const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /cURL Workbench/);
      assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal((await fetch(base + '/js/parser.js')).status, 200);
    });
    await t.test('forwards POST body, query, auth-like headers and records response metadata', async () => {
      const { status, data } = await send(payload);
      assert.equal(status, 200); assert.equal(data.status, 200); assert.ok(data.duration >= 0); assert.ok(data.size > 0);
      const echoed = JSON.parse(data.body);
      assert.deepEqual(echoed, { method: 'POST', url: '/echo?a=1&a=2', body: payload.body, testHeader: 'hello', cookie: 'session=test' });
      assert.deepEqual(data.skippedHeaders, ['Host', 'Content-Length']);
      assert.ok(data.headers.some(row => row.key === 'x-upstream'));
    });
    await t.test('GET/HEAD and non-2xx upstream statuses remain visible', async () => {
      const get = await send({ url: target + '/error', method: 'GET', headers: [] }); assert.equal(get.data.status, 422);
      const head = await send({ url: target, method: 'HEAD', headers: [] }); assert.equal(head.data.body, '');
      const redirect = await send({ url: target + '/redirect', method: 'GET', headers: [] }); assert.equal(redirect.data.status, 302);
    });
    await t.test('rejects invalid protocols, payload shapes, header injection and foreign origins', async () => {
      for (const bad of [{ ...payload, url: 'file:///etc/passwd' }, { ...payload, method: 'TRACE' }, { ...payload, method: 'GET' }, { ...payload, headers: [{ key: 'X-Test', value: 'ok\r\nInjected: true' }] }, { ...payload, body: {} }, { ...payload, headers: null }]) assert.equal((await send(bad)).status, 400);
      assert.equal((await send(payload, { Origin: 'https://untrusted.example' })).status, 403);
      assert.equal((await send(payload, { Origin: base })).status, 200);
      const hostStatus = await new Promise((resolve, reject) => {
        const call = http.get(base, { headers: { Host: 'attacker.example' } }, result => { result.resume(); resolve(result.statusCode); });
        call.on('error', reject);
      });
      assert.equal(hostStatus, 403);
    });
    await t.test('times out and caps upstream response size', async () => {
      assert.equal((await send({ url: target + '/slow', method: 'GET', headers: [] })).status, 504);
      assert.equal((await send({ url: target + '/large', method: 'GET', headers: [] })).status, 413);
    });
    await t.test('reports connection failures as useful proxy errors', async () => {
      const unused = http.createServer(); const unusedUrl = await serve(unused); await close(unused);
      assert.equal((await send({ url: unusedUrl, method: 'GET', headers: [] })).status, 502);
    });
  } finally { await close(proxy); await close(upstream); }
});
