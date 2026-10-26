import { buildUrl } from './parser.js';

export function requestPayload(request) {
  const headers = request.headers.filter(row => row.enabled && row.key.trim()).map(({ key, value }) => ({ key: key.trim(), value }));
  const hasBody = request.bodyMode !== 'none';
  if (hasBody && !headers.some(row => row.key.toLowerCase() === 'content-type')) {
    headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
  }
  return { method: request.method, url: buildUrl(request), headers, ...(hasBody ? { body: request.body } : {}) };
}

const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;

export function generateCurl(request) {
  const payload = requestPayload(request);
  const lines = [`curl --request ${payload.method} ${shellQuote(payload.url)}`];
  for (const header of payload.headers) lines.push(`  --header ${shellQuote(header.value === '' ? `${header.key};` : `${header.key}: ${header.value}`)}`);
  if (payload.body !== undefined) lines.push(`  --data-raw ${shellQuote(payload.body)}`);
  return lines.join(' \\\n');
}

export function generateSnippet(request, client = 'fetch') {
  const { method, url, headers, body } = requestPayload(request);
  const headerPairs = headers.map(header => `    ${JSON.stringify([header.key, header.value])}`).join(',\n');
  const headerCode = headers.length ? `[\n${headerPairs}\n  ]` : '[]';
  if (client === 'axios') {
    return `import axios from 'axios';\n\nconst response = await axios({\n  method: ${JSON.stringify(method)},\n  url: ${JSON.stringify(url)},\n  headers: Object.fromEntries(${headerCode}),${body !== undefined ? `\n  data: ${JSON.stringify(body)},\n  transformRequest: [(data) => data],` : ''}\n  validateStatus: () => true,\n  maxRedirects: 0,\n  timeout: 30000,\n});\n\nconsole.log(response.status);\nconsole.log(response.data);`;
  }
  return `const response = await fetch(${JSON.stringify(url)}, {\n  method: ${JSON.stringify(method)},\n  headers: ${headerCode},${body !== undefined ? `\n  body: ${JSON.stringify(body)},` : ''}\n  redirect: 'manual',\n  signal: AbortSignal.timeout(30000),\n});\n\nconst text = await response.text();\nlet data;\ntry { data = JSON.parse(text); } catch { data = text; }\nconsole.log(response.status);\nconsole.log(data);`;
}

export function validateRequest(request) {
  const errors = [];
  try {
    const url = new URL(buildUrl(request));
    if (!['http:', 'https:'].includes(url.protocol)) errors.push('Use an HTTP or HTTPS URL.');
    if (url.username || url.password) errors.push('Use an Authorization header instead of credentials in the URL.');
  } catch { errors.push('Enter a valid HTTP or HTTPS URL.'); }
  if (['GET', 'HEAD'].includes(request.method) && request.bodyMode !== 'none') errors.push(`${request.method} requests cannot send a body through Node.js fetch. Select Body → None or change the method.`);
  if (['CONNECT', 'TRACE', 'TRACK'].includes(request.method)) errors.push(`${request.method} is not supported by Node.js fetch.`);
  else if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(request.method)) errors.push(`${request.method} cannot run through the proxy. Choose a supported HTTP method.`);
  for (const row of request.headers.filter(row => row.enabled)) {
    if (!/^[!#$%&'*+.^_`|~\da-zA-Z-]+$/.test(row.key) || /[\r\n\0]/.test(row.value)) errors.push('Each enabled header needs a valid name and a single-line value.');
  }
  return [...new Set(errors)];
}
