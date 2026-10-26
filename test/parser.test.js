import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseCurl, tokenize, buildUrl } from '../src/public/js/parser.js';
import { generateCurl, generateSnippet, requestPayload, validateRequest } from '../src/public/js/generators.js';

test('Chrome Bash: multiline POST, JSON, colons in headers, duplicate query params', () => {
  const command = `curl 'https://example.com/api?tag=one&tag=two&sig=a%20b%2fc' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer abc:def' \\\n  --data-raw '{"title":"Hello world","nested":{"ok":true}}'`;
  const request = parseCurl(command);
  assert.equal(request.method, 'POST');
  assert.equal(request.baseUrl, 'https://example.com/api');
  assert.deepEqual(request.params.map(row => row.key), ['tag', 'tag', 'sig']);
  assert.equal(request.headers[1].value, 'Bearer abc:def');
  assert.equal(JSON.parse(request.body).nested.ok, true);
  assert.equal(buildUrl(request), 'https://example.com/api?tag=one&tag=two&sig=a%20b%2fc');
});

test('CMD: CRLF continuations, caret quotes, escaped JSON quotes, and ampersands', () => {
  const command = 'curl.exe "https://example.com/api?a=1&b=2" ^\r\n -H "Content-Type: application/json" ^\r\n --data-raw "{^"name^":^"Ada^"}"';
  const request = parseCurl(command);
  assert.equal(request.method, 'POST');
  assert.deepEqual(JSON.parse(request.body), { name: 'Ada' });
  assert.equal(request.params.length, 2);
  const chrome = 'curl "https://example.com" ^\n --data-raw "{\\^"ok\\^":true}"';
  assert.equal(parseCurl(chrome).body, '{"ok":true}');
});

test('Chrome and Edge native CMD export: caret-wrapped groups and two-layer JSON escaping', () => {
  const command = String.raw`curl --url ^"https://example.com/api?a=1^&b=2^" ^
  -H ^"Content-Type: application/json^" ^
  -H ^"X-Empty;^" ^
  --data-raw ^"^{^\^"name^\^":^\^"Ada Lovelace^\^",^\^"path^\^":^\^"C:^\^\^\^\temp^\^"^}^"`;
  const request = parseCurl(command);
  assert.equal(buildUrl(request), 'https://example.com/api?a=1&b=2');
  assert.deepEqual(JSON.parse(request.body), { name: 'Ada Lovelace', path: 'C:\\temp' });
  assert.equal(request.headers[1].value, '');
  assert.match(generateCurl(request), /X-Empty;/);
  assert.deepEqual(requestPayload(parseCurl(generateCurl(request))), requestPayload(request));
});

test('Chrome CMD export preserves caret-escaped percentages, literal newlines, and glob-escaped URLs', () => {
  const request = parseCurl(String.raw`curl --url ^"https://example.com/?a=^\[^\]^\{^\}^" -b ^"session=^%^22foo^%^3D^" --data-raw ^"first^

second^"`);
  assert.equal(request.params[0].value, '[]{}');
  assert.equal(request.headers[0].value, 'session=%22foo%3D');
  assert.equal(request.body, 'first\nsecond');
  const bash = parseCurl(String.raw`curl 'https://example.com/?a=\[\]\{\}'`);
  assert.equal(bash.params[0].value, '[]{}');
});

test('POSIX quote concatenation, escaped double quotes, and ANSI-C escapes', () => {
  const request = parseCurl(String.raw`curl https://example.com -d '{"title":"it'\''s fine"}'`);
  assert.equal(JSON.parse(request.body).title, "it's fine");
  assert.deepEqual(tokenize(String.raw`curl "https://example.com" -d "{\"ok\":true}"`).slice(-1), ['{"ok":true}']);
  assert.equal(parseCurl(String.raw`curl https://example.com --data-raw $'a\nb\t\x41\u0042\101'`).body, 'a\nb\tABA');
});

test('single-quoted body whitespace and literal backslash/newline are preserved', () => {
  const body = '  line one\nline two\\\nthree  ';
  assert.equal(parseCurl(`curl https://example.com --data-raw '${body}'`).body, body);
});

test('explicit method, attached flags, equals syntax, HEAD and --get', () => {
  assert.equal(parseCurl('curl -XPATCH --url=https://example.com --header="X-One: one" -dvalue').method, 'PATCH');
  assert.equal(parseCurl('curl -I https://example.com').method, 'HEAD');
  const request = parseCurl('curl -G https://example.com?q=old --data-urlencode "q=a b" --data-urlencode "q=c&d"');
  assert.equal(buildUrl(request), 'https://example.com?q=old&q=a+b&q=c%26d');
  assert.equal(request.method, 'GET'); assert.equal(request.bodyMode, 'none');
});

test('multiple data arguments, literal @ payload, cookies and empty body', () => {
  assert.equal(parseCurl('curl https://example.com -d a=1 --data b=2').body, 'a=1&b=2');
  assert.equal(parseCurl('curl https://example.com --data-raw @literal').body, '@literal');
  assert.equal(parseCurl('curl https://example.com -b "session=xyz; lang=en"').headers[0].key, 'Cookie');
  const request = parseCurl("curl https://example.com -d ''");
  assert.equal(request.method, 'POST'); assert.equal(request.bodyMode, 'raw');
  assert.equal(requestPayload(request).body, '');
});

test('malformed and unsupported input fails clearly without executing shell', () => {
  for (const command of ['echo test', 'curl', "curl 'https://example.com", 'curl ftp://example.com', 'curl https://example.com -X', 'curl https://example.com --data-binary @file', 'curl https://example.com -F a=b', 'curl https://example.com https://other.com', 'curl https://example.com --header Broken', 'curl https://example.com --data-urlencode name@file']) {
    assert.throws(() => parseCurl(command), undefined, command);
  }
  assert.equal(parseCurl("curl https://example.com --data-raw '$(whoami); rm -rf /'").body, '$(whoami); rm -rf /');
});

test('disabled fields are excluded and edits retain duplicate keys', () => {
  const request = parseCurl("curl 'https://example.com?tag=a&tag=b' -H 'X-One: one'");
  request.params[0].enabled = false; request.params[1].value = 'space & plus+'; request.headers[0].enabled = false;
  assert.equal(buildUrl(request), 'https://example.com?tag=space+%26+plus%2B');
  assert.equal(requestPayload(request).headers.length, 0);
  assert.doesNotMatch(generateCurl(request), /X-One/);
});

test('generated cURL round-trips quotes, multiline bodies, headers and encoding', () => {
  const request = parseCurl("curl 'https://example.com?x=%2F&x=b' -X PUT -H 'Content-Type: application/json'");
  request.bodyMode = 'raw'; request.body = '{"text":"O\'Reilly",\n"other":"$HOME `echo` \\\\ "}';
  const rebuilt = parseCurl(generateCurl(request));
  assert.deepEqual(requestPayload(rebuilt), requestPayload(request));
});

test('fetch snippet executes with the same request and handles text responses', async () => {
  const request = parseCurl("curl https://example.com -H 'Content-Type: application/json' --data-raw '{\"ok\":true}'");
  let captured;
  const context = vm.createContext({ fetch: async (url, options) => { captured = { url, options }; return { status: 418, text: async () => 'plain text' }; }, AbortSignal, console: { log() {} } });
  const script = new vm.Script(`(async () => { ${generateSnippet(request)} })()`);
  await script.runInContext(context);
  assert.equal(captured.url, 'https://example.com');
  assert.equal(captured.options.body, request.body);
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.redirect, 'manual');
  assert.match(generateSnippet(request, 'axios'), /transformRequest/);
});

test('validation catches fetch body restrictions and header injection', () => {
  const request = parseCurl('curl https://example.com -X GET -d hello');
  assert.match(validateRequest(request)[0], /cannot send a body/);
  request.method = 'POST'; request.headers.push({ key: 'X-Test', value: 'one\r\nInjected: yes', enabled: true });
  assert.match(validateRequest(request)[0], /single-line/);
});

test('axios snippet preserves literal payload and does not throw on upstream HTTP errors', async () => {
  const request = parseCurl("curl https://example.com -d 'a=1&b=two'");
  let captured;
  const context = vm.createContext({ axios: async options => { captured = options; return { status: 422, data: 'error' }; }, console: { log() {} } });
  const snippet = generateSnippet(request, 'axios').replace("import axios from 'axios';", '');
  await new vm.Script(`(async () => { ${snippet} })()`).runInContext(context);
  assert.equal(captured.data, 'a=1&b=two');
  assert.equal(captured.transformRequest[0](captured.data), captured.data);
  assert.equal(captured.validateStatus(422), true);
  assert.equal(captured.maxRedirects, 0);
  assert.equal(captured.headers['Content-Type'], 'application/x-www-form-urlencoded');
});
