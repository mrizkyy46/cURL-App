# Tailwind CSS migration

## Audit and acceptance plan

- Stack: Express 5 serves static HTML and vanilla JavaScript; Node.js 18+ runtime. No CSS framework or frontend bundler was installed.
- Styling: `src/public/css/styles.css` owned all styling, resets, local monospace font fallback, and a permanently dark color scheme. No light theme or theme switch exists.
- Tokens: canvas `#0b1120`, surface `#0f172a`, raised `#172237`, border `#29354a`, text `#e2e8f0`, muted `#98a8bf`, cyan `#22d3ee`, green `#6ee7b7`, yellow `#facc75`, red `#fda4af`; further literal colors distinguish code, controls, and feedback.
- Layout: desktop columns use 1.12:1, compact desktop 1.1:1, and a single column at <=800px. Existing boundaries are <=380, <=480, <=800, <=1100, and >=1500px. Preserve exact inclusive boundaries.
- Reusable components: panels/headings, buttons, tabs/counts, key/value tables, code windows, feedback, status badges, dialogs, and history rows.
- JavaScript owns state classes (`active`, `disabled`, `added`, `success`, `error`, `copied`, `failed`, `redirect`), method data attributes, and classes on generated elements. Keep these contracts and all application modules unchanged.
- Interaction styling: cyan keyboard focus, hover colors, disabled controls, 300ms row highlight, 150ms button transitions, dialog backdrop, and reduced-motion overrides.
- Initial validation: `npm test` passed 28 tests. No build or lint command existed.

## Review stages

1. **Expand:** add the pinned Tailwind 4.1.18 CLI, CSS-first theme, and explicit HTML/JS source scanning. Version 4.1 retains Node 18 support; newer v4 toolchains require Node 20. Generate local CSS for the existing CSP. Keep the legacy stylesheet during comparison.
2. **Layout and reusable components:** put layout utilities in HTML; express shared components with `@apply` in Tailwind's components layer. Preserve state selectors for dynamically generated markup. Use standard spacing utilities and named design tokens rather than arbitrary values.
3. **Feature panels:** migrate import/request forms, tables, body editor, generated code, response states, toast, help, and history. Preserve native element defaults by importing theme/utilities without Preflight. Keep only CSS that describes native defaults, complex grid templates, or exact existing typography/geometry that has no suitable standard utility.
4. **Verify and contract:** compare legacy and compiled CSS in Chromium across viewports and interaction states. Run build, JS/CSS lint, existing tests, and browser smoke checks; remove the legacy stylesheet only once no runtime references remain. There is no old CSS framework dependency to remove.

## Forward and rollback paths

The browser receives only compiled `src/public/css/tailwind.css`; source CSS lives in `src/styles/`. `npm start` builds CSS first, and `npm run dev` runs the CSS watcher alongside the server watcher. Generated CSS is ignored by Git. CI must compile before testing static serving.

Rollback is a Git revert of this migration: restore the original stylesheet and HTML link, then revert build/lint configuration and the lockfile together. No stored requests, API payloads, server handlers, parser, generators, or state management change; no data migration is necessary.

## Compatibility references

- [Tailwind CLI](https://tailwindcss.com/docs/installation/tailwind-cli)
- [Theme variables](https://tailwindcss.com/docs/theme)
- [Importing Tailwind without Preflight](https://tailwindcss.com/docs/preflight#disabling-preflight)
- [Browser requirements](https://tailwindcss.com/docs/compatibility): Safari 16.4+, Chrome 111+, Firefox 128+.

Verification results and remaining limits are recorded after implementation below.

## Implementation and verification

- Completed the stages above. Source is separated into entry, theme, base, and component files. The HTML owns the main layout utilities, while reusable/dynamic components use `@apply`. All spacing uses Tailwind's numeric utilities; nonstandard typography, palette, radii, and column ratios retain named tokens or small custom utilities. No arbitrary-value classes were introduced.
- Preserved every application JavaScript module and `server.js` without changes. Renamed only the styling class `table-caption` to `kv-caption` because it collides with a built-in Tailwind display utility; no JavaScript references that class.
- Retained `[hidden]` with `!important`, the dark native-control scheme, exact inclusive media boundaries, native defaults without Preflight, and all dynamic state selectors. Kept CSS for exact button transitions, native font inheritance, dialog/viewport sizing, and the response grid where it preserves the previous geometry directly.
- Added local CSS build/watch commands, automatic build before start/dev, JS/CSS lint, CI build/lint steps, and a static-serving regression assertion for compiled CSS. Tailwind, ESLint 9, and Stylelint 16.8.2 are pinned; the latter avoids newer transitive dependencies that require Node 20.

| Check | Result |
| --- | --- |
| Baseline tests before edits | 28 passed |
| Build and JS/CSS lint | Passed |
| Application tests after edits | 28 passed on Node 26.4.0 and Node 18.20.8 |
| Build, ESLint, Stylelint on Node 18.20.8 | Passed |
| Chromium baseline screenshots | Pixel-identical at 360, 380, 381, 390, 480, 481, 768, 800, 801, 1024, 1100, 1101, 1440, 1499, 1500, and 1720px; no horizontal page overflow |
| State screenshots | 36/36 identical: 18 states at 390 and 1440px, including hover, keyboard focus, headers, disabled rows, body, empty/error/warning states, Axios, help/history dialogs, response status variants, and response headers |
| Editor + local proxy browser checks | 25 checks passed; no browser errors |
| History browser checks | 35 checks passed; no browser errors |
| Focus, theme, motion, copy, visibility | 8 checks passed, including row animation duration, reduced-motion overrides, and retaining the dark theme under a light OS preference |
| Development startup | Both server/CSS watchers started; compiled CSS served with HTTP 200 |

Local before/after screenshots are available under ignored `artifacts/tailwind-before-*.png`, `artifacts/tailwind-after-*.png`, and `artifacts/states-*.png`. They are review artifacts rather than committed replacements for the README images. The Chromium comparison served the original CSS via request interception and adjusted only the renamed caption selector; application markup and state were otherwise identical between captures.

Not verified locally: Firefox, Safari/WebKit, physical mobile/touch rendering, or execution of the hosted GitHub Actions matrix on Node 20/22. Viewport tests use Chromium desktop emulation. Pixel equality is scoped to the captured states and the fonts/browser available on this Windows machine.

An additional npm audit found one existing high-severity advisory in production dependency `body-parser@2.3.0` (GHSA-27r3-jxmh-p828). Its version and all pre-existing dependency versions are preserved by this styling migration. The existing CI audit gate may fail until that separate dependency update is addressed. On Node 26, Tailwind emits a `module.register()` deprecation warning; the build succeeds, and the Node 18 build has no such warning.
