// @ts-check
// The standalone version (Cloudflare Pages): no Claude runtime, translation via /api/translate.
const { test, expect } = require("@playwright/test");
const { installKataMocks } = require("../support/kata-mocks");

async function openStandalone(page, cfg = {}) {
  await page.addInitScript(({ src, cfg }) => {
    // eslint-disable-next-line no-eval
    const install = eval("(" + src + ")");
    install(window, cfg);
  }, { src: installKataMocks.toString(), cfg: { claude: false, ...cfg } });
  await page.goto("/");
}
const translate = async (page, word) => {
  await page.locator("#wordInput").fill(word);
  await page.locator("#translateBtn").click();
};

test.describe("Standalone app (Cloudflare)", () => {
  test("translates through /api/translate with the right query", async ({ page }) => {
    let query;
    await page.route("**/api/translate?*", (route) => {
      query = new URL(route.request().url()).searchParams;
      route.fulfill({ json: { translation: "terima kasih", alternatives: ["makasih"], source: "MyMemory" } });
    });
    await openStandalone(page);
    await translate(page, "thank you");
    await expect(page.locator("#resultBox .trans")).toHaveText("terima kasih");
    await expect(page.locator("#resultBox")).toContainText("Also: makasih");
    await expect(page.locator("#resultBox")).toContainText("Translated by MyMemory");
    expect(query.get("q")).toBe("thank you");
    expect(query.get("from")).toBe("en-US");
    expect(query.get("to")).toBe("ms-MY");
  });

  test("saves an API translation and practices it", async ({ page }) => {
    await page.route("**/api/translate?*", (r) => r.fulfill({ json: { translation: "helo", alternatives: [], source: "MyMemory" } }));
    await openStandalone(page);
    await translate(page, "hello");
    await page.locator("#saveBtn").click();
    await expect(page.locator("#wordCount")).toHaveText("(1)");
    await expect(page.locator("#storeNote")).toHaveText("Words are saved on this device.");
    await page.locator("#tab-practice").click();
    await expect(page.locator("#practiceBox")).toContainText("Card 1 of 1");
  });

  test("falls back to manual entry when the function fails", async ({ page }) => {
    await page.route("**/api/translate?*", (r) => r.fulfill({ status: 502, json: { error: "Translation service unavailable." } }));
    await openStandalone(page);
    await translate(page, "hello");
    await expect(page.locator("#manTrans")).toBeVisible();
    await expect(page.locator("#addHint")).toHaveText("Automatic translation isn't available right now. Add the translation yourself.");
  });

  test("tells you when you're offline", async ({ page, context }) => {
    await openStandalone(page);
    await context.setOffline(true);
    await translate(page, "hello");
    await expect(page.locator("#addHint")).toHaveText("You're offline. Add the translation yourself and it'll be saved.");
    await expect(page.locator("#manTrans")).toBeVisible();
  });

  test("greets without a Claude account and asks for a name", async ({ page }) => {
    await openStandalone(page);
    await expect(page.locator("#greet")).toContainText("Hai! What words do you want to translate today?");
    await expect(page.getByRole("button", { name: "Tell me your name" })).toBeVisible();
  });

  test("install button stays hidden until the browser offers install", async ({ page }) => {
    await openStandalone(page);
    await expect(page.locator("#installBtn")).toBeHidden();
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true });
      e.prompt = () => { window.__prompted = true; };
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(e);
    });
    await expect(page.locator("#installBtn")).toBeVisible();
    await page.locator("#installBtn").click();
    expect(await page.evaluate(() => window.__prompted)).toBe(true);
    await expect(page.locator("#installBtn")).toBeHidden();
  });
});

test.describe("Installable app files", () => {
  test("manifest is valid and its icons exist", async ({ page, request }) => {
    await openStandalone(page);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "manifest.webmanifest");
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m).toMatchObject({ short_name: "Kata", display: "standalone", start_url: "/" });
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    for (const icon of m.icons) {
      const img = await request.get("/" + icon.src);
      expect(img.ok(), icon.src).toBe(true);
      expect(img.headers()["content-type"]).toBe("image/png");
    }
  });

  test("service worker is served and never caches /api", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBe(true);
    const code = await res.text();
    expect(code).toContain('const CACHE = "kata-');
    expect(code).toContain('startsWith("/api/")');
  });
});
