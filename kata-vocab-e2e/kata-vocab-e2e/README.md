# Kata: voice vocabulary app with Playwright and Cypress tests

![E2E tests](https://github.com/zalenagit/kata-vocab-e2e/actions/workflows/e2e.yml/badge.svg)

Kata ("word" in Malay) is a small vocabulary notebook. You say or type a word, get it translated into Malay or one of 15 other languages, hear it read aloud, and practice it with spaced-repetition flashcards.

This repo is a QA portfolio project. It covers the same 22 user journeys twice, once in **Playwright** and once in **Cypress**, so the two frameworks can be compared side by side. CI runs on every push through GitHub Actions.

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
```

The app is served at `http://localhost:4173` by a zero-dependency Node server (`scripts/serve.js`).

## Project layout

```
app/index.html                 the app under test
scripts/serve.js               static server
tests/support/kata-mocks.js    shared test doubles
tests/playwright/kata.spec.js  Playwright suite
cypress/e2e/kata.cy.js         Cypress suite
playwright.config.js
cypress.config.js
.github/workflows/e2e.yml      CI: Playwright browser matrix plus Cypress
```

## Playwright vs Cypress: notes from writing both

- **Reloading:** `cy.reload()` skips `onBeforeLoad`, so the Cypress suite re-visits the page to keep its mocks. Playwright's `addInitScript` re-runs on every navigation.
- **Dialogs:** Playwright handles `prompt` and `confirm` with `page.once("dialog")`. Cypress auto-accepts `confirm` and stubs `prompt` with `cy.stub`.
- **3D transforms:** Cypress's actionability check can treat buttons on a 3D-flipped card as covered, so those clicks use `{ force: true }`. Playwright clicks them directly.
- **Browsers:** Playwright runs WebKit and Firefox out of the box. The Cypress suite targets Chrome.
