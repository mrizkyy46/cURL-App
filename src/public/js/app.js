import { parseCurl, emptyRequest, splitUrl, buildUrl } from './parser.js';
import { generateCurl, generateSnippet, requestPayload, validateRequest } from './generators.js';
import { createHistoryStore, HISTORY_KEY } from './history.js';

const $ = id => document.getElementById(id);
const example = `curl 'https://jsonplaceholder.typicode.com/posts?userId=1&_limit=3' \\
  -H 'Accept: application/json' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Request-Source: curl-workbench'`;
let request = emptyRequest(), client = 'fetch', responseData = null, activeController = null;
let parseTimer, toastTimer;
const historyStore = createHistoryStore();
let historyEntries = [], historyError = '';

function message(id, text) { $(id).textContent = text; $(id).hidden = !text; }
function toast(text, error = false) {
  clearTimeout(toastTimer);
  $('toast').classList.toggle('error', error);
  message('toast', text);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}

// Rendering uses text nodes throughout, including untrusted request/response data.
function highlight(target, code, shell = false) {
  const fragment = document.createDocumentFragment();
  const pattern = shell ? /'(?:[^']|'\\'')*'|\b(?:curl)\b|--[\w-]+/g : /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|await|try|catch|import|from|true|false)\b|\b\d+\b/g;
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    fragment.append(document.createTextNode(code.slice(last, match.index)));
    const span = document.createElement('span');
    span.className = /^["']/.test(match[0]) ? 'syntax-string' : /^\d/.test(match[0]) ? 'syntax-number' : shell ? 'syntax-command' : 'syntax-keyword';
    span.textContent = match[0]; fragment.append(span); last = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(code.slice(last)));
  target.replaceChildren(fragment);
}

function updateOutputs() {
  const curl = generateCurl(request), snippet = generateSnippet(request, client);
  highlight($('curl-output'), curl, true); highlight($('snippet-output'), snippet);
  $('curl-lines').textContent = curl.split('\n').map((_, i) => i + 1).join('\n');
  $('snippet-lines').textContent = snippet.split('\n').map((_, i) => i + 1).join('\n');
  const errors = validateRequest(request);
  message('validation-message', request.baseUrl ? errors.join(' ') : 'Paste a cURL command or enter a URL to start.');
  if (!activeController) $('send-button').disabled = errors.length > 0;
  for (const kind of ['params', 'headers']) $(kind + '-count').textContent = request[kind].filter(row => row.enabled).length;
  $('body-dot').hidden = request.bodyMode === 'none';
  const fields = [...request.params, ...request.headers].filter(row => row.enabled).length;
  $('enabled-summary').textContent = `${fields} active field${fields === 1 ? '' : 's'}`;
  $('method').dataset.method = request.method;
  $('save-history').disabled = !request.baseUrl;
}

function renderHistory() {
  $('history-count').textContent = historyError ? '!' : historyEntries.length;
  $('history-button').setAttribute('aria-label', historyError ? 'Open cURL history, history needs attention' : `Open cURL history, ${historyEntries.length} saved requests`);
  $('clear-history').disabled = !historyEntries.length && !historyError;
  $('history-empty').hidden = Boolean(historyEntries.length || historyError);
  message('history-error', historyError);
  $('history-list').replaceChildren();
  for (const entry of historyEntries) {
    const item = document.createElement('li'), open = document.createElement('button');
    open.className = 'history-open';
    const method = document.createElement('span'); method.className = 'history-method'; method.dataset.method = entry.request.method; method.textContent = entry.request.method;
    const details = document.createElement('span'); details.className = 'history-details';
    const url = document.createElement('span'); url.className = 'history-url'; url.textContent = buildUrl(entry.request); url.title = url.textContent;
    const date = document.createElement('time'); date.dateTime = new Date(entry.savedAt).toISOString(); date.textContent = new Date(entry.savedAt).toLocaleString();
    details.append(url, date); open.append(method, details);
    open.addEventListener('click', () => {
      if (activeController) { message('history-error', 'Cancel the running request before opening history.'); return; }
      clearTimeout(parseTimer);
      request = JSON.parse(JSON.stringify(entry.request));
      $('curl-input').value = generateCurl(request);
      syncEditor(); resetResponse();
      $('parse-status').textContent = 'Loaded from history'; $('parse-status').className = 'status-badge success';
      $('request-state').textContent = 'Ready to edit';
      message('parse-error', ''); message('parse-warnings', request.warnings.join(' ')); message('body-error', '');
      $('history-dialog').close(); $('url').focus(); toast('Request loaded from history.');
    });
    const remove = document.createElement('button'); remove.className = 'delete-row'; remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete ${entry.request.method} ${buildUrl(entry.request)} from history`);
    remove.addEventListener('click', () => {
      const index = historyEntries.findIndex(item => item.id === entry.id);
      try {
        historyEntries = historyStore.remove(entry.id); historyError = ''; renderHistory();
        const buttons = $('history-list').querySelectorAll('.history-open');
        (buttons[Math.min(index, buttons.length - 1)] || $('close-history')).focus();
      } catch (error) { historyError = error.message; renderHistory(); }
    });
    item.append(open, remove); $('history-list').append(item);
  }
}

function refreshHistory() {
  try { historyEntries = historyStore.list(); historyError = ''; }
  catch (error) { historyEntries = []; historyError = error.message; }
  renderHistory();
}

function saveHistory(showSuccess = false) {
  try {
    historyEntries = historyStore.save(request); historyError = ''; renderHistory();
    if (showSuccess) toast('Request saved to history.');
    return true;
  } catch (error) {
    historyError = error.message; renderHistory(); toast(error.message, true);
    return false;
  }
}

function renderRows(kind, animate = false) {
  const target = $(kind + '-rows');
  target.replaceChildren();
  if (!request[kind].length) {
    const tr = document.createElement('tr'); tr.className = 'table-empty';
    const td = document.createElement('td'); td.colSpan = 4; td.textContent = kind === 'params' ? 'No query parameters. Add one below.' : 'No headers. Add one below.';
    tr.append(td); target.append(tr); return;
  }
  request[kind].forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.classList.toggle('disabled', !row.enabled);
    if (animate && index === request[kind].length - 1) tr.classList.add('added');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = row.enabled;
    checkbox.setAttribute('aria-label', `Enable ${kind === 'params' ? 'parameter' : 'header'} ${index + 1}`);
    checkbox.addEventListener('change', () => { row.enabled = checkbox.checked; tr.classList.toggle('disabled', !row.enabled); updateOutputs(); });
    const td = document.createElement('td'); td.append(checkbox); tr.append(td);
    for (const property of ['key', 'value']) {
      const cell = document.createElement('td'), input = document.createElement('input');
      input.type = 'text'; input.value = row[property]; input.spellcheck = false; input.autocomplete = 'off'; input.placeholder = property === 'key' ? 'Key' : 'Value';
      input.setAttribute('aria-label', `${kind === 'params' ? 'Parameter' : 'Header'} ${property} ${index + 1}`);
      input.addEventListener('input', () => { row[property] = input.value; updateOutputs(); });
      cell.append(input); tr.append(cell);
    }
    const removeCell = document.createElement('td'), remove = document.createElement('button');
    remove.className = 'delete-row'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${kind === 'params' ? 'parameter' : 'header'} ${index + 1}`);
    remove.addEventListener('click', () => { request[kind].splice(index, 1); renderRows(kind); updateOutputs(); const buttons = target.querySelectorAll('.delete-row'); (buttons[Math.min(index, buttons.length - 1)] || document.querySelector(`[data-add="${kind}"]`)).focus(); });
    removeCell.append(remove); tr.append(removeCell); target.append(tr);
  });
}

function syncBody() {
  $('body-mode').value = request.bodyMode; $('body-input').value = request.body;
  $('body-input').disabled = request.bodyMode === 'none';
  $('format-json').disabled = request.bodyMode !== 'raw';
  $('body-hint').textContent = request.bodyMode === 'none' ? 'Select a body type to send a payload.' : request.bodyMode === 'form' ? 'Enter encoded key=value pairs separated by &. Content-Type is set to application/x-www-form-urlencoded.' : 'For JSON, add a Content-Type: application/json header. Payloads are sent exactly as written.';
}

function syncEditor() {
  if (![...$('method').options].some(option => option.value === request.method)) {
    const option = document.createElement('option'); option.textContent = request.method; $('method').append(option);
  }
  $('method').value = request.method; $('url').value = request.baseUrl;
  renderRows('params'); renderRows('headers'); syncBody(); updateOutputs();
}

function parseInput(manual = false) {
  clearTimeout(parseTimer);
  if (!$('curl-input').value.trim()) { $('parse-status').textContent = 'Ready to paste'; $('parse-status').className = 'status-badge'; message('parse-error', ''); message('parse-warnings', ''); return; }
  try {
    const parsed = parseCurl($('curl-input').value);
    request = parsed; syncEditor();
    $('parse-status').textContent = 'Parsed successfully'; $('parse-status').className = 'status-badge success';
    $('request-state').textContent = 'Ready to edit'; message('parse-error', ''); message('parse-warnings', request.warnings.join(' ')); message('body-error', '');
    if (manual && saveHistory()) toast('cURL parsed and saved to history.');
  } catch (error) {
    $('parse-status').textContent = 'Check your command'; $('parse-status').className = 'status-badge error';
    message('parse-error', error.message); message('parse-warnings', ''); $('request-state').textContent = 'Previous request retained';
  }
}

function resetResponse() {
  responseData = null; $('response-result').hidden = true; $('response-empty').hidden = false;
  $('response-meta').textContent = 'No request sent'; message('response-error', ''); message('proxy-note', '');
}

function renderResponseBody() {
  let body = responseData?.body || '';
  if ($('pretty-response').checked) { try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* Preserve non-JSON responses. */ } }
  $('response-body').textContent = body || '(empty response body)';
}

async function sendRequest(event) {
  event?.preventDefault();
  if (activeController) { activeController.abort(); return; }
  const errors = validateRequest(request);
  if (errors.length) { toast(errors[0], true); return; }
  saveHistory();
  const controller = new AbortController(); activeController = controller;
  $('send-button').textContent = 'Cancel'; $('send-button').disabled = false;
  $('response-meta').textContent = 'Sending…'; message('response-error', '');
  const timer = setTimeout(() => controller.abort('timeout'), 35000);
  try {
    const result = await fetch('/api/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestPayload(request)), signal: controller.signal });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || `Proxy error ${result.status}`);
    responseData = data;
    $('response-empty').hidden = true; $('response-result').hidden = false;
    const status = document.createElement('span'); status.className = 'http-status' + (data.status >= 400 ? ' failed' : data.status >= 300 ? ' redirect' : '');
    status.textContent = `${data.status} ${data.statusText}`;
    const time = document.createElement('span'); time.textContent = `${data.duration} ms`;
    const size = document.createElement('span'); size.textContent = data.size < 1024 ? `${data.size} B` : `${(data.size / 1024).toFixed(1)} KB`;
    $('response-meta').replaceChildren(status, time, size);
    $('response-header-count').textContent = data.headers.length;
    $('response-headers').replaceChildren();
    for (const header of data.headers) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = header.key; dd.textContent = header.value; $('response-headers').append(dt, dd); }
    renderResponseBody();
    message('proxy-note', data.skippedHeaders.length ? `Transport headers managed by Node.js: ${data.skippedHeaders.join(', ')}.` : '');
  } catch (error) {
    $('response-meta').textContent = controller.signal.aborted ? 'Request stopped' : 'Request failed';
    message('response-error', controller.signal.aborted ? (controller.signal.reason === 'timeout' ? 'Request exceeded the 35 second client timeout.' : 'Request cancelled.') : error.message);
  } finally {
    clearTimeout(timer); activeController = null; $('send-button').textContent = 'Send ↗'; updateOutputs();
  }
}

function tabGroup(selector, activate) {
  const tabs = [...document.querySelectorAll(selector)];
  const select = tab => {
    for (const current of tabs) { current.classList.toggle('active', current === tab); current.setAttribute('aria-selected', String(current === tab)); current.tabIndex = current === tab ? 0 : -1; }
    activate(tab);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); select(tabs[next]); tabs[next].focus(); }
    });
  });
}

$('curl-input').addEventListener('input', () => { clearTimeout(parseTimer); $('parse-status').textContent = 'Parsing…'; parseTimer = setTimeout(() => parseInput(), 200); });
$('parse-button').addEventListener('click', () => parseInput(true));
$('clear-input').addEventListener('click', () => {
  clearTimeout(parseTimer); activeController?.abort(); $('curl-input').value = ''; request = emptyRequest();
  syncEditor(); parseInput(); resetResponse(); message('body-error', ''); $('request-state').textContent = 'Ready to edit'; $('curl-input').focus();
});
$('load-example').addEventListener('click', () => { $('curl-input').value = example; parseInput(); toast('Example loaded. Edit a field to see the code update.'); });
$('method').addEventListener('change', () => { request.method = $('method').value; updateOutputs(); });
$('url').addEventListener('input', () => {
  request.baseUrl = $('url').value.trim();
  if (request.baseUrl.includes('?')) {
    try { const parsed = splitUrl(request.baseUrl); Object.assign(request, parsed); $('url').value = request.baseUrl; renderRows('params'); } catch { /* Keep incomplete URLs editable. */ }
  }
  updateOutputs();
});
$('url').addEventListener('blur', () => { if (request.baseUrl.includes('#')) { request.baseUrl = request.baseUrl.split('#')[0]; $('url').value = request.baseUrl; updateOutputs(); toast('URL fragment removed; fragments are not sent to servers.'); } });
document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => {
  const kind = button.dataset.add; request[kind].push({ key: '', value: '', enabled: true }); renderRows(kind, true); updateOutputs();
  $(kind + '-rows').lastElementChild.querySelector('input[type=text]').focus();
}));
$('body-mode').addEventListener('change', () => {
  request.bodyMode = $('body-mode').value;
  if (request.bodyMode === 'form') {
    const header = request.headers.find(row => row.enabled && row.key.toLowerCase() === 'content-type');
    if (header) header.value = 'application/x-www-form-urlencoded';
    else request.headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true });
    renderRows('headers');
  }
  syncBody(); updateOutputs(); message('body-error', '');
});
$('body-input').addEventListener('input', () => { request.body = $('body-input').value; updateOutputs(); message('body-error', ''); });
$('format-json').addEventListener('click', () => {
  try { request.body = JSON.stringify(JSON.parse(request.body), null, 2); syncBody(); updateOutputs(); message('body-error', ''); toast('JSON formatted.'); }
  catch { message('body-error', 'Invalid JSON. Check quotes, commas, and brackets before formatting.'); }
});
$('request-form').addEventListener('submit', sendRequest);
$('pretty-response').addEventListener('change', renderResponseBody);
tabGroup('[data-editor-tab]', tab => { for (const name of ['params', 'headers', 'body']) $(name + '-panel').hidden = name !== tab.dataset.editorTab; });
tabGroup('[data-response-tab]', tab => { for (const name of ['body', 'headers']) $('response-' + name + '-panel').hidden = name !== tab.dataset.responseTab; });
tabGroup('[data-client]', tab => { client = tab.dataset.client; $('snippet-panel').setAttribute('aria-labelledby', tab.id); $('snippet-note').textContent = client === 'fetch' ? 'Built into Node.js. No dependencies.' : 'Install first: npm install axios · Save as .mjs'; updateOutputs(); });
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($(button.dataset.copy).textContent);
    const label = button.querySelector('span'); const previous = label.textContent; label.textContent = 'Copied!'; button.classList.add('copied');
    setTimeout(() => { label.textContent = previous; button.classList.remove('copied'); }, 1800);
  } catch { toast('Clipboard access unavailable. Select the code and copy it manually.', true); }
}));
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('history-button').addEventListener('click', () => { refreshHistory(); $('history-dialog').showModal(); });
$('close-history').addEventListener('click', () => $('history-dialog').close());
$('save-history').addEventListener('click', () => saveHistory(true));
$('clear-history').addEventListener('click', () => {
  try { historyEntries = historyStore.clear(); historyError = ''; renderHistory(); $('close-history').focus(); toast('History cleared.'); }
  catch (error) { historyError = error.message; renderHistory(); }
});
window.addEventListener('storage', event => { if (event.key === HISTORY_KEY || event.key === null) refreshHistory(); });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !document.querySelector('dialog[open]')) { event.preventDefault(); if (event.shiftKey) parseInput(true); else sendRequest(); } });
refreshHistory();
$('curl-input').value = example;
parseInput();
