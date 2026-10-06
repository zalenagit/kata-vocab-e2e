# Kata: voice vocabulary app with Playwright and Cypress tests

![E2E tests](https://github.com/zalenagit/kata-vocab-e2e/actions/workflows/e2e.yml/badge.svg)

Kata ("word" in Malay) is a small vocabulary notebook. You say or type a word, get it translated into Malay or one of 15 other languages, hear it read aloud, and practice it with spaced-repetition flashcards.

Kata is an installable app (PWA): it works on desktop and phones, opens offline, and is hosted free on **Cloudflare Pages**, with translation handled by a **Pages Function**.

This repo is a QA portfolio project. It covers the same 30 user journeys twice, once in **Playwright** and once in **Cypress**, so the two frameworks can be compared side by side, plus unit tests for the Cloudflare function. CI runs on every push through GitHub Actions.

## Architecture

```
Browser (app/index.html, installable PWA)
  ├── speech in/out ........ Web Speech API (on the device)
  ├── saved words .......... localStorage (on the device)
  ├── offline .............. service worker (app/sw.js)
  └── GET /api/translate ──> Cloudflare Pages Function (functions/api/translate.js)
                               ├── validates input, allows 16 languages
                               ├── caches answers at the edge for 24h
                               └── calls MyMemory free translation API
```

Inside claude.ai, the same page uses Claude for richer translations (meaning, examples, romanization) and saves words to the Claude account instead.

## What's tested

| Area | Scenarios |
| --- | --- |
| Greeting | Greets the viewer by first name; falls back to a plain greeting when no name is available; a custom name persists after reload |
| Translation | English to Malay with meaning, example and alternatives; Enter key; romanization for non-Latin scripts (Japanese); empty input and same-language validation; language swap |
| Error handling | Manual-entry fallback when AI permission is declined; rate-limit message |
| Security | Hostile HTML in input and translated output renders as plain text (XSS check) |
| Voice | Speech-to-text fills and translates; silence message; unsupported-browser message; text-to-speech uses the correct language code |
| Persistence | Saved words survive reload; saving again updates the word instead of duplicating it |
| Word list | Search, no-results state, delete with confirm, empty state |
| Flashcards | Flip by click and Space; grading; a missed card is requeued at the end of the round; keyboard shortcut; reverse mode; pronunciation check pass and fail |
| Layout | No horizontal scroll at 360px phone width |
| Standalone mode | Translation via `/api/translate` with correct query; save and practice; manual fallback on 502 and network errors; offline message; greeting without an account |
| Installable app | Install button appears only when the browser offers install; manifest fields and icons; service worker served and never caches `/api` |
| Unit (function) | Translation and de-duplicated alternatives; HTML entity decoding; input validation without upstream calls; quota → 429; upstream failures → 502; secret never leaked to the browser |

Playwright runs the suite in Chromium, Firefox, WebKit (Safari) and a Pixel 7 mobile profile. Cypress runs it in Chrome.

## Test design

The app depends on things a CI runner doesn't have: an AI translation service, the browser's speech engines, and a microphone. `tests/support/kata-mocks.js` replaces all of them with deterministic test doubles. **Both frameworks share this one file.**

- **Translation:** a fake translator returns fixed dictionary entries and can be told to fail with specific error codes (`not_granted`, `rate_limited`).
- **Text-to-speech:** a fake `speechSynthesis` records every utterance and its language, so tests can assert what would be spoken.
- **Speech-to-text:** a fake `SpeechRecognition` replays queued transcripts, so voice input runs without a microphone.
- **Test data:** a seeding option preloads saved words for flashcard and list tests.

Selectors use stable element IDs and ARIA labels rather than CSS structure.

## Bug found by this suite

While building the suite, the "flip, grade, and requeue" test failed. The **Again / Got it** buttons were visible before the card was flipped: a `display: grid` CSS rule overrode the HTML `hidden` attribute. The fix was a global `[hidden] { display: none !important; }` rule, and the test now guards against regressions.

## Deploy to Cloudflare Pages (free)

1. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, and pick this repo.
2. Build settings: framework preset **None**, build command **empty**, build output directory **`app`**.
3. Deploy. Cloudflare picks up `functions/` automatically, so `/api/translate` goes live with the site.
4. Optional: add an environment variable `MYMEMORY_EMAIL` (Settings → Variables and Secrets) to raise MyMemory's free daily limit.

Every push to `main` redeploys; pull requests get preview URLs.

## Run it locally

```bash
npm install
npx playwright install        # downloads the test browsers once

npm run test:pw               # Playwright, all browsers
npm run test:pw:chromium      # Playwright, Chromium only
npm run test:pw:ui            # Playwright interactive UI mode
npm run report:pw             # open the last HTML report

npm run test:cy               # Cypress headless (starts the app for you)
npm run cy:open               # Cypress interactive runner (run `npm run serve` first)

npm run test:unit             # unit tests for the Cloudflare function
npm run dev                   # full local Cloudflare emulation, including /api/translate (uses wrangler)
```

The app is served at `http://localhost:4173` by a zero-dependency Node server (`scripts/serve.js`).

## Project layout

```
app/index.html                 the app under test
app/manifest.webmanifest       install metadata
app/sw.js                      service worker (offline)
app/icons/                     app icons
functions/api/translate.js     Cloudflare Pages Function
tests/unit/                    unit tests for the function
scripts/serve.js               static server
tests/support/kata-mocks.js    shared test doubles
tests/playwright/              Playwright suites (Claude mode + standalone mode)
cypress/e2e/                   Cypress suites (Claude mode + standalone mode)
playwright.config.js
cypress.config.js
.github/workflows/e2e.yml      CI: unit tests, Playwright browser matrix, Cypress
```

## Playwright vs Cypress: notes from writing both

- **Reloading:** `cy.reload()` skips `onBeforeLoad`, so the Cypress suite re-visits the page to keep its mocks. Playwright's `addInitScript` re-runs on every navigation.
- **Dialogs:** Playwright handles `prompt` and `confirm` with `page.once("dialog")`. Cypress auto-accepts `confirm` and stubs `prompt` with `cy.stub`.
- **3D transforms:** Cypress's actionability check can treat buttons on a 3D-flipped card as covered, so those clicks use `{ force: true }`. Playwright clicks them directly.
- **Browsers:** Playwright runs WebKit and Firefox out of the box. The Cypress suite targets Chrome.
