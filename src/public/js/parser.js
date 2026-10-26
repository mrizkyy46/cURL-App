/** Parse text only. Shell expressions are never evaluated or executed. */
export function tokenize(source) {
  const windows = /\^(?:\r?\n|["&|<>])/.test(source) || /^\s*curl\.exe\b/i.test(source);
  const tokens = [];
  let token = '', quote = '', cmdBuffer = '', started = false;
  const push = () => { if (started) tokens.push(token); token = ''; started = false; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    // DevTools CMD exports use caret-quoted groups, then CRT backslash escaping.
    if (quote === 'cmd-export') {
      if (char === '^' && next === '"') {
        const slashes = /\\+$/.exec(cmdBuffer)?.[0].length || 0;
        if (slashes % 2) cmdBuffer += '"';
        else { token += cmdBuffer.replace(/\\([\\"])/g, '$1'); cmdBuffer = ''; quote = ''; }
        i++; continue;
      }
      if (char === '^' && /\r|\n/.test(next || '')) { if (next === '\r') i++; i++; continue; }
      if (char === '^' && next) { cmdBuffer += next; i++; }
      else cmdBuffer += char;
      continue;
    }
    if (windows && !quote && char === '^' && next === '"') { quote = 'cmd-export'; started = true; i++; continue; }
    if (quote !== "'" && quote !== 'ansi' && (char === '\\' || char === '^') && /\r|\n/.test(next || '')) {
      if (next === '\r') i++;
      i++;
      continue;
    }
    if (windows && char === '^' && next && quote !== "'") {
      token += next; i++; started = true; continue;
    }
    if (quote === 'ansi' && char === '\\') {
      const rest = source.slice(i + 1);
      const match = /^(?:x[\da-fA-F]{1,2}|u[\da-fA-F]{4}|U[\da-fA-F]{8}|[0-7]{1,3})/.exec(rest);
      if (match) {
        const digits = match[0];
        const value = parseInt(/^[xuU]/.test(digits) ? digits.slice(1) : digits, /^[xuU]/.test(digits) ? 16 : 8);
        if (value > 0x10ffff) throw new Error('Invalid Unicode escape in ANSI-C quoted string.');
        token += String.fromCodePoint(value); i += digits.length;
      } else {
        const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', a: '\x07', e: '\x1b', '\\': '\\', "'": "'", '"': '"' };
        token += escapes[next] ?? `\\${next ?? ''}`; i++;
      }
      continue;
    }
    if (quote === "'" || quote === 'ansi') {
      if (char === "'") quote = ''; else token += char;
      continue;
    }
    if (windows && char === '\\' && next === '^' && source[i + 2] === '"') {
      token += '"'; i += 2; started = true; continue;
    }
    if (char === '\\' && next && (!quote || /["\\$`]/.test(next))) {
      // Chrome's CMD export can escape a quote as \^".
      token += next; i++;
      started = true; continue;
    }
    if (quote === '"') { if (char === '"') quote = ''; else token += char; continue; }
    if (char === '$' && next === "'") { quote = 'ansi'; i++; started = true; continue; }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/\s/.test(char)) { push(); continue; }
    token += char; started = true;
  }
  if (quote) throw new Error('Unclosed quote. Paste the complete cURL command.');
  push();
  return tokens;
}

export function splitUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http:// or https:// URL.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are unsupported. Use an Authorization header.');
  const withoutHash = input.split('#')[0];
  const question = withoutHash.indexOf('?');
  const baseUrl = question < 0 ? withoutHash : withoutHash.slice(0, question);
  const params = question < 0 ? [] : withoutHash.slice(question + 1).split('&').filter(Boolean).map(raw => {
    const [key, value] = [...new URLSearchParams(raw)][0];
    return { key, value, enabled: true, raw, originalKey: key, originalValue: value };
  });
  return { baseUrl, params };
}

export function buildUrl(request) {
  const query = request.params.filter(row => row.enabled).map(row =>
    row.raw !== undefined && row.key === row.originalKey && row.value === row.originalValue
      ? row.raw : new URLSearchParams([[row.key, row.value]]).toString()
  ).join('&');
  return request.baseUrl + (query ? `?${query}` : '');
}

export function emptyRequest() {
  return { method: 'GET', baseUrl: '', params: [], headers: [], bodyMode: 'none', body: '', warnings: [] };
}

export function parseCurl(source) {
  const tokens = tokenize(source.trim());
  if (!/^curl(?:\.exe)?$/i.test(tokens.shift() || '')) throw new Error('Start your command with curl or curl.exe.');
  const result = emptyRequest();
  const bodies = [];
  let url = '', explicitMethod = '', head = false, get = false, hasBody = false, globoff = false;
  const ignored = new Set(['--compressed', '--silent', '-s', '--show-error', '-S']);
  const warned = new Set(['--location', '-L', '--insecure', '-k', '--http1.1', '--http2', '--http3', '--path-as-is']);
  const options = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--url', '-b', '--cookie', '-A', '--user-agent', '-e', '--referer']);
  for (let i = 0; i < tokens.length; i++) {
    let option = tokens[i], inline;
    const long = /^(--[^=]+)=(.*)$/s.exec(option);
    const short = /^(-[XHdbAe])(.+)$/s.exec(option);
    if (long || short) [, option, inline] = long || short;
    if (options.has(option)) {
      const value = inline ?? tokens[++i];
      if (value === undefined) throw new Error(`Missing value for ${option}.`);
      if (option === '-X' || option === '--request') explicitMethod = value.toUpperCase();
      else if (option === '--url') { if (url) throw new Error('Use one target URL per request.'); url = value; }
      else if (option === '-H' || option === '--header') {
        const colon = value.indexOf(':');
        if (colon < 0 && value.endsWith(';') && value.length > 1) result.headers.push({ key: value.slice(0, -1).trim(), value: '', enabled: true });
        else {
          if (colon <= 0) throw new Error('Headers must use the format Name: value.');
          const headerValue = value.slice(colon + 1).trim();
          result.headers.push({ key: value.slice(0, colon).trim(), value: headerValue, enabled: true });
          if (!headerValue) result.warnings.push(`${value.slice(0, colon)} is represented as an explicit empty header value.`);
        }
      } else if (['-b', '--cookie', '-A', '--user-agent', '-e', '--referer'].includes(option)) {
        if ((option === '-b' || option === '--cookie') && !value.includes('=')) throw new Error('Cookie files cannot be read. Paste an inline cookie string.');
        const key = ['-b', '--cookie'].includes(option) ? 'Cookie' : ['-A', '--user-agent'].includes(option) ? 'User-Agent' : 'Referer';
        result.headers.push({ key, value, enabled: true });
      } else {
        hasBody = true;
        if (option !== '--data-raw' && (value.startsWith('@') || (option === '--data-urlencode' && /^[^=]*@/.test(value)))) {
          throw new Error('File payloads cannot be read. Paste their contents using --data-raw.');
        }
        if (option === '--data-urlencode') {
          const equal = value.indexOf('=');
          bodies.push(equal < 0 ? encodeURIComponent(value) : `${value.slice(0, equal)}=${encodeURIComponent(value.slice(equal + 1))}`);
        } else bodies.push(value);
      }
    } else if (option === '-I' || option === '--head') head = true;
    else if (option === '-G' || option === '--get') get = true;
    else if (option === '--globoff' || option === '-g') globoff = true;
    else if (ignored.has(option)) continue;
    else if (warned.has(option)) result.warnings.push(`${option} is not applied by the editor or proxy.`);
    else if (option.startsWith('-')) throw new Error(`Unsupported option: ${option}. Remove it before parsing.`);
    else if (/^https?:\/\//i.test(option)) { if (url) throw new Error('Use one target URL per request.'); url = option; }
    else throw new Error(`Unexpected argument: ${option}. Quote URLs and payloads containing spaces.`);
  }
  if (!url) throw new Error('No target URL found. Include an http:// or https:// URL.');
  if (!globoff) url = url.replace(/\\([\[\]{}])/g, '$1');
  if (url.includes('#')) result.warnings.push('URL fragments are omitted because they are not sent to the server.');
  Object.assign(result, splitUrl(url));
  result.method = explicitMethod || (head ? 'HEAD' : get ? 'GET' : hasBody ? 'POST' : 'GET');
  if (!/^[A-Z]+$/.test(result.method)) throw new Error('Invalid HTTP method.');
  result.body = bodies.join('&');
  if (get && hasBody) {
    result.params.push(...[...new URLSearchParams(result.body)].map(([key, value]) => ({ key, value, enabled: true })));
    result.body = '';
  } else if (hasBody) {
    const contentType = result.headers.find(row => row.key.toLowerCase() === 'content-type')?.value || '';
    result.bodyMode = contentType.includes('application/x-www-form-urlencoded') ? 'form' : 'raw';
  }
  return result;
}
