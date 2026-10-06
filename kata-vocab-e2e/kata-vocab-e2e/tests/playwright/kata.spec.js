// @ts-check
const { test, expect } = require("@playwright/test");
const { installKataMocks, seedWords } = require("../support/kata-mocks");

/** Open Kata with the mocked Claude runtime and speech APIs. */
async function openKata(page, cfg = {}) {
  await page.addInitScript(({ src, cfg }) => {
    // eslint-disable-next-line no-eval
    const install = eval("(" + src + ")");
    install(window, cfg);
  }, { src: installKataMocks.toString(), cfg });
  await page.goto("/");
}

const translate = async (page, word) => {
  await page.locator("#wordInput").fill(word);
  await page.locator("#translateBtn").click();
};

test.describe("Greeting", () => {
  test("greets the viewer by first name", async ({ page }) => {
    await openKata(page);
    await expect(page.locator("#greet")).toHaveText("Hai, Zalina! What words do you want to translate today?");
  });

  test("falls back to a plain greeting and lets you set a name that sticks", async ({ page }) => {
    await openKata(page, { name: "" });
    await expect(page.locator("#greet")).toContainText("Hai! What words do you want to translate today?");
    page.once("dialog", (d) => d.accept("Zee"));
    await page.getByRole("button", { name: "Tell me your name" }).click();
    await expect(page.locator("#greet")).toHaveText("Hai, Zee! What words do you want to translate today?");
    await page.reload();
    await expect(page.locator("#greet")).toContainText("Hai, Zee!");
  });
});

test.describe("Translate", () => {
  test("translates English to Malay with meaning, example and alternatives", async ({ page }) => {
    await openKata(page);
    await translate(page, "hello");
    const result = page.locator("#resultBox");
    await expect(result.locator(".trans")).toHaveText("helo");
    await expect(result).toContainText("A word used to greet someone.");
    await expect(result).toContainText("Helo, apa khabar?");
    await expect(result).toContainText("Also: hai, salam");
  });

  test("Enter key translates", async ({ page }) => {
    await openKata(page);
    await page.locator("#wordInput").fill("hello");
    await page.locator("#wordInput").press("Enter");
    await expect(page.locator("#resultBox .trans")).toHaveText("helo");
  });

  test("shows romanization for non-Latin scripts", async ({ page }) => {
    await openKata(page);
    await page.locator("#toLang").selectOption("ja-JP");
    await translate(page, "water");
    await expect(page.locator("#resultBox .trans")).toHaveText("水");
    await expect(page.locator("#resultBox .romaji")).toHaveText("mizu");
  });

  test("validates empty input and matching languages", async ({ page }) => {
    await openKata(page);
    await page.locator("#translateBtn").click();
    await expect(page.locator("#addHint")).toHaveText("Type or say a word first.");
    await page.locator("#toLang").selectOption("en-US");
    await translate(page, "hello");
    await expect(page.locator("#addHint")).toHaveText("Pick two different languages.");
  });

  test("swap button reverses the language pair", async ({ page }) => {
    await openKata(page);
    await page.locator("#swap").click();
    await expect(page.locator("#fromLang")).toHaveValue("ms-MY");
    await expect(page.locator("#toLang")).toHaveValue("en-US");
  });

  test("reads the word and translation aloud in the right languages", async ({ page }) => {
    await openKata(page);
    await translate(page, "hello");
    await page.getByRole("button", { name: "Hear hello" }).click();
    await page.getByRole("button", { name: "Hear the translation" }).click();
    const spoken = await page.evaluate(() => window.__spoken);
    expect(spoken).toEqual([{ text: "hello", lang: "en-US" }, { text: "helo", lang: "ms-MY" }]);
  });

  test("renders hostile text as plain text (no XSS)", async ({ page }) => {
    await openKata(page);
    const payload = "<img src=x onerror=window.__xss=1>";
    await translate(page, payload);
    await expect(page.locator("#resultBox .word")).toHaveText(payload);
    await page.locator("#resultBox .trans").hover();
    await expect(page.locator("#resultBox img, #resultBox b, #resultBox script")).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test("falls back to manual entry when Claude permission is declined", async ({ page }) => {
    await openKata(page, { sampleError: "not_granted" });
    await translate(page, "hello");
    await expect(page.locator("#manTrans")).toBeVisible();
    await page.locator("#saveBtn").click();
    await expect(page.locator("#addHint")).toHaveText("Add a translation before saving.");
    await page.locator("#manTrans").fill("helo");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#wordCount")).toHaveText("(1)");
  });

  test("shows a retry message when translation fails", async ({ page }) => {
    await openKata(page, { sampleError: "rate_limited" });
    await translate(page, "hello");
    await expect(page.locator("#addHint")).toHaveText("Too many lookups at once. Wait a moment, then try again.");
  });
});

test.describe("Voice input", () => {
  test("speaking a word fills the box and translates it", async ({ page }) => {
    await openKata(page, { speech: ["hello"] });
    await page.locator("#micBtn").click();
    await expect(page.locator("#wordInput")).toHaveValue("hello");
    await expect(page.locator("#resultBox .trans")).toHaveText("helo");
  });

  test("silence gives a helpful message", async ({ page }) => {
    await openKata(page, { speech: [] });
    await page.locator("#micBtn").click();
    await expect(page.locator("#addHint")).toHaveText("Didn't hear anything. Tap the mic and try again.");
  });

  test("unsupported browsers are told to type instead", async ({ page }) => {
    await openKata(page, { speechRecognition: false });
    await page.locator("#micBtn").click();
    await expect(page.locator("#addHint")).toContainText("Voice input isn't supported in this browser.");
  });
});

test.describe("Saving words", () => {
  test("saves a word, keeps it after reload, and updates instead of duplicating", async ({ page }) => {
    await openKata(page);
    await translate(page, "hello");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#addHint")).toContainText("Saved “hello”");
    await expect(page.locator("#wordCount")).toHaveText("(1)");

    await translate(page, "Hello");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#addHint")).toContainText("Updated “Hello”");
    await expect(page.locator("#wordCount")).toHaveText("(1)");

    await page.reload();
    await expect(page.locator("#wordCount")).toHaveText("(1)");
  });
});

test.describe("My words", () => {
  test("lists, searches and deletes words", async ({ page }) => {
    await openKata(page, { seedWords: seedWords() });
    await page.locator("#tab-list").click();
    await expect(page.locator("ul.words li")).toHaveCount(2);

    await page.locator("#search").fill("terima");
    await expect(page.locator("ul.words li")).toHaveCount(1);
    await page.locator("#search").fill("zzz");
    await expect(page.locator("#listBox")).toContainText("No words match");
    await page.locator("#search").fill("");

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete hello" }).click();
    await expect(page.locator("ul.words li")).toHaveCount(1);
    await expect(page.locator("#wordCount")).toHaveText("(1)");
  });

  test("empty notebook invites you to add a word", async ({ page }) => {
    await openKata(page);
    await page.locator("#tab-list").click();
    await expect(page.locator("#listBox")).toContainText("Your notebook is empty");
  });
});

test.describe("Flashcards", () => {
  test("empty deck state", async ({ page }) => {
    await openKata(page);
    await page.locator("#tab-practice").click();
    await expect(page.locator("#practiceBox")).toContainText("No words yet");
  });

  test("flip, grade, and requeue a missed card", async ({ page }) => {
    await openKata(page, { seedWords: seedWords() });
    await expect(page.locator("#dueCount")).toHaveText("(2)");
    await page.locator("#tab-practice").click();
    await expect(page.locator("#practiceBox")).toContainText("Card 1 of 2");

    await expect(page.locator("#grade")).toBeHidden();
    await page.locator("#card .face.front .word").click();
    await expect(page.locator("#card")).toHaveClass(/flipped/);
    await page.locator("#gotBtn").click();

    await expect(page.locator("#practiceBox")).toContainText("Card 2 of 2");
    await page.locator("#card").focus();
    await page.keyboard.press("Space");
    await page.locator("#againBtn").click();

    // A missed card comes back at the end of the round.
    await expect(page.locator("#practiceBox")).toContainText("Card 3 of 3");
    await page.locator("#card").focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("2"); // shortcut for Got it
    await expect(page.locator("#practiceBox")).toContainText("Round finished");
    await expect(page.locator("#dueCount")).toHaveText("");
  });

  test("reverse mode shows the Malay side first", async ({ page }) => {
    await openKata(page, { seedWords: seedWords() });
    await page.locator("#tab-practice").click();
    await page.locator("#revToggle").check();
    const front = await page.locator("#card .face.front p").innerText();
    expect(["helo", "terima kasih"]).toContain(front);
  });

  test("say-it check passes for the right word and fails for the wrong one", async ({ page }) => {
    await openKata(page, { seedWords: seedWords() });
    await page.locator("#tab-practice").click();
    const answer = await page.locator("#card .face.back .trans").innerText();
    await page.evaluate((a) => window.__speechQueue.push(a, "something else"), answer);

    await page.locator("#card .face.front .word").click();
    await page.locator("#sayIt").click();
    await expect(page.locator("#sayResult")).toContainText("Nice");
    await page.locator("#sayIt").click();
    await expect(page.locator("#sayResult")).toContainText("Heard “something else”");
  });
});

test.describe("Layout", () => {
  test("no horizontal scroll on a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openKata(page, { seedWords: seedWords() });
    await translate(page, "thank you");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
