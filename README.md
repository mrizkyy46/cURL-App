# cURL Workbench

A local Node.js developer tool for turning DevTools cURL commands into editable requests, Bash commands, and Node.js fetch / axios snippets.

## Screenshots

**Desktop**

![cURL Workbench desktop view](docs/screenshots/curl-workbench-desktop.png)

**Mobile**

![cURL Workbench mobile view](docs/screenshots/curl-workbench-mobile.png)

## Run

Requires Node.js 18 or newer and npm. Installing/building the development tools requires Node.js 18.18+ (or 20.9+); Node.js 22 is also supported in CI.

```sh
npm install
npm start
```

Open **http://127.0.0.1:3000**. Set `PORT` to change the listening port. `npm start` builds the local Tailwind stylesheet before starting Express. `npm run dev` builds once, then watches both the server and Tailwind sources. To build CSS separately, run `npm run build`; `npm run dev:css` watches only CSS.

Styling uses Tailwind CSS 4.1.18, pinned to retain Node.js 18 compatibility. The existing dark theme, native control defaults, responsive boundaries, and state classes are preserved. Tailwind Preflight is intentionally omitted. Use modern browsers supported by [Tailwind v4](https://tailwindcss.com/docs/compatibility) (Chrome 111+, Safari 16.4+, Firefox 128+).

## Use

1. In browser DevTools → Network, right-click a request and copy it as cURL.
2. Paste the command into **Import cURL**. Parsing runs automatically; **Parse cURL** runs it immediately.
3. Edit the method, base URL, query parameters, headers, or body. Rebuilt cURL and both Node.js snippets update immediately. Checkboxes exclude individual rows.
4. Choose **Send** to execute through the local proxy and inspect status, duration, headers, and body. Click **Cancel** to stop a request.
5. Copy generated code. Save Node.js snippets as `.mjs` files; axios snippets also require `npm install axios`. Generated cURL uses Bash / POSIX quoting.

Shortcuts: **Ctrl/Cmd + Enter** sends; **Ctrl/Cmd + Shift + Enter** parses. Tabs support arrow keys, Home, and End.

## cURL history

Use **Save to history** beside the rebuilt cURL to save the current edited request. Successful manual **Parse cURL** actions and valid **Send** attempts also save a snapshot. Automatic parsing while typing, loading the example, and opening an existing entry do not create history entries.

Open **History** in the app header to restore or delete a request, or choose **Clear history** to remove all saved entries. Restoring opens the full editor, including disabled rows and the original query encoding; it never sends a request. Exact duplicate snapshots move to the top instead of creating another entry. The latest 50 requests are retained, with older entries removed when the local history size limit is reached.

History persists across reloads in this browser's local storage for the same app origin. It contains complete headers and body, which may include credentials, and is not encrypted. Delete saved requests before sharing a browser profile. It is not stored in the project, sent to a history server, or included in Git commits. Browser storage restrictions or capacity errors are shown without blocking the editor or request execution.

## Structure and data flow

```text
server.js                     Express static server + POST /api/proxy
src/public/index.html         Accessible two-column workspace
src/styles/tailwind.css       Tailwind entry and explicit source scanning
src/styles/theme.css          Existing design tokens and responsive variants
src/styles/base.css           Native defaults, dark scheme, keyboard focus
src/styles/components.css     Shared components, state styles, responsive overrides
src/public/css/tailwind.css   Generated stylesheet (ignored by Git)
src/public/js/parser.js       Shell tokenizer + request model
src/public/js/generators.js   cURL, fetch, axios + validation
src/public/js/history.js      Browser-local request snapshots
src/public/js/app.js          Reactive editor + response viewer
test/                        Parser, generator, and proxy integration tests
```

Raw command → shell tokens → normalized request model → form editor → generators / proxy → response viewer. Editing the form changes generated output; the original import remains available for reference. No shell commands are executed. The active editor is held in memory; saved history snapshots persist in browser local storage.

## Supported parsing

Bash/POSIX quotes, ANSI-C `$'…'` escapes, backslash multiline continuations, CMD caret continuations/escapes, Chrome/Edge caret-wrapped CMD groups (`^"…^"`), `curl.exe`, repeated query keys, original query encoding, headers (`-H`, `--header`, including empty `Name;` headers), method (`-X`, `--request`), `--url`, `--data-raw`, `--data`, `-d`, `--data-binary`, inline `--data-urlencode`, cookies, user agent, referer, HEAD, and `--get`. Supports attached short options and `--option=value`. Data implies POST unless a method is explicit. Multiple data options join with `&`, matching cURL. A missing body Content-Type defaults to `application/x-www-form-urlencoded`, matching cURL; add `Content-Type: application/json` for JSON.

Unsupported flags fail visibly. Transport flags such as `--location` and `--insecure` produce warnings; the proxy does not follow redirects or disable TLS verification. File payloads, multipart upload, shell expansion/evaluation, and multiple URLs are unsupported. Use inline body text instead. GET/HEAD bodies cannot run via Node.js fetch and are blocked by validation. Duplicate query parameters and headers remain editable; Node's HTTP clients may combine duplicate headers, while the axios snippet uses one value per header name.

## Proxy contract and limits

`POST /api/proxy` accepts JSON:

```json
{
  "url": "https://example.com/api",
  "method": "POST",
  "headers": [{ "key": "Content-Type", "value": "application/json" }],
  "body": "{\"hello\":\"world\"}"
}
```

Omit `body` for GET/HEAD. Success returns `{ status, statusText, duration, headers, body, size, skippedHeaders }`. Upstream errors (such as 404) are valid responses; proxy failures return `{ error }` with an appropriate status.

The server listens only on `127.0.0.1` and checks Host and Origin. HTTP(S) targets, including local development APIs, are allowed. Do not expose this tool as a public open proxy. Requests have a 30 second timeout, a 2 MB JSON input limit, a 200-header limit, and a 5 MB decoded response limit. Responses are displayed as UTF-8 text; binary file downloads and streaming are outside this version. Transport headers such as Host, Content-Length, Connection and Accept-Encoding are managed by Node.js and listed as skipped. Node fetch may normalize headers and decompress responses, so this is not a byte-for-byte cURL transport emulator. No automatic request runs on page load.

## Publishing

The app includes no API keys or service credentials. Saved history stays in browser local storage; **Send** forwards headers and bodies to the target server. Do not commit `.env` files or real captured requests. The supplied `.gitignore` excludes local environment files, npm credentials, private keys, dependencies, and browser test artifacts. This app is a local developer tool; it is not configured for public hosting or exposed proxy access.

## Contributing

Create a short branch from `main` for each change. Use a Conventional Commit message such as `feat: add request history` or `fix: preserve repeated query keys`. Before opening a pull request, run `npm run build`, `npm run lint`, `npm test`, and `npm audit --omit=dev`. GitHub Actions checks Node.js 18, 20, and 22 on pushes and pull requests.

Keep `main` releasable: changes enter through reviewed pull requests after CI passes. See the [styling migration audit and verification report](docs/tailwind-migration.md) for design decisions, migration stages, and rollback instructions.

## Verify

```sh
npm run build
npm run lint
npm test
```

Uses Node's built-in test runner, a local HTTP fixture, and no third-party test server. Build first so the static-serving test can verify the compiled stylesheet. Covers Bash/CMD/ANSI-C parsing, malformed input, query encoding, disabled fields, round-trip reconstruction, generated fetch execution, proxy forwarding, origin/host checks, upstream errors, redirects, timeouts, and response limits. Lint checks JavaScript with ESLint and CSS with Stylelint; the Tailwind build also validates utility names in `@apply`.

Parser semantics were checked against the [cURL manual](https://curl.se/docs/manpage.html) and [Chromium's DevTools export tests](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/panels/network/NetworkLogView.test.ts). Static serving and request handling use the [Express API](https://expressjs.com/en/5x/api.html).
