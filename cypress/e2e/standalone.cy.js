// The standalone version (Cloudflare Pages): no Claude runtime, translation via /api/translate.
const { installKataMocks } = require("../../tests/support/kata-mocks");

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  androidWhatsApp: "Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 WhatsApp/2.24",
  desktopFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"
};

const visitStandalone = (cfg = {}) =>
  cy.visit("/", { onBeforeLoad: (win) => installKataMocks(win, { claude: false, ...cfg }) });

const translate = (word) => {
  cy.get("#wordInput").clear().type(word);
  cy.get("#translateBtn").click();
};

describe("Standalone app (Cloudflare)", () => {
  it("translates through /api/translate with the right query", () => {
    cy.intercept("GET", "/api/translate?*", {
      body: { translation: "terima kasih", alternatives: ["makasih"], source: "MyMemory" }
    }).as("translate");
    visitStandalone();
    translate("thank you");
    cy.wait("@translate").then(({ request }) => {
      const q = new URL(request.url).searchParams;
      expect(q.get("q")).to.equal("thank you");
      expect(q.get("from")).to.equal("en-US");
      expect(q.get("to")).to.equal("ms-MY");
    });
    cy.get("#resultBox .trans").should("have.text", "terima kasih");
    cy.get("#resultBox").should("contain.text", "Also: makasih").and("contain.text", "Translated by MyMemory");
  });

  it("saves an API translation and practices it", () => {
    cy.intercept("GET", "/api/translate?*", { body: { translation: "helo", alternatives: [], source: "MyMemory" } });
    visitStandalone();
    translate("hello");
    cy.get("#saveBtn").click();
    cy.get("#wordCount").should("have.text", "(1)");
    cy.get("#storeNote").should("have.text", "Words are saved on this device.");
    cy.get("#tab-practice").click();
    cy.get("#practiceBox").should("contain.text", "Card 1 of 1");
  });

  it("falls back to manual entry when the function fails", () => {
    cy.intercept("GET", "/api/translate?*", { statusCode: 502, body: { error: "Translation service unavailable." } });
    visitStandalone();
    translate("hello");
    cy.get("#manTrans").should("be.visible");
    cy.get("#addHint").should("have.text", "Automatic translation isn't available right now. Add the translation yourself.");
  });

  it("falls back to manual entry on a network error", () => {
    cy.intercept("GET", "/api/translate?*", { forceNetworkError: true });
    visitStandalone();
    translate("hello");
    cy.get("#manTrans").should("be.visible");
  });

  it("greets without a Claude account and asks for a name", () => {
    visitStandalone();
    cy.get("#greet").should("contain.text", "Hai! What words do you want to translate today?");
    cy.contains("button", "Tell me your name").should("be.visible");
  });

  it("install button uses the browser's install prompt when offered", () => {
    visitStandalone();
    cy.get("#installBtn").should("be.visible");
    cy.window().then((win) => {
      const e = new win.Event("beforeinstallprompt", { cancelable: true });
      e.prompt = cy.stub().as("prompt");
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      win.dispatchEvent(e);
    });
    cy.get("#installBtn").click();
    cy.get("@prompt").should("have.been.calledOnce");
    cy.get("#installBtn").should("not.be.visible");
    cy.get("#installGuide").should("not.be.visible");
  });

  it("install button is hidden once Kata is installed", () => {
    visitStandalone({ installed: true });
    cy.get("#installBtn").should("not.be.visible");
  });
});

describe("In-app install guide", () => {
  const openGuide = (cfg) => {
    visitStandalone(cfg);
    cy.get("#installBtn").click();
    cy.get("#installGuide").should("be.visible");
  };

  it("iPhone Safari: Share, Add to Home Screen, Add", () => {
    openGuide({ userAgent: UA.iphoneSafari });
    cy.get("#installGuide li").should("have.length", 3);
    cy.get("#installGuide").should("contain.text", "Add to Home Screen");
    cy.get("#guideLink").should("not.exist");
  });

  it("iPhone Chrome: suggests Safari and offers the link", () => {
    openGuide({ userAgent: UA.iphoneChrome });
    cy.get("#installGuide").should("contain.text", "open this page in Safari");
    cy.get("#guideLink").invoke("val").should("match", /http:\/\/localhost:4173\//);
  });

  it("Android Chrome: menu, Install app", () => {
    openGuide({ userAgent: UA.androidChrome });
    cy.get("#installGuide").should("contain.text", "Install app");
    cy.get("#installGuide li").should("have.length", 3);
  });

  it("in-app browsers are told to open a real browser", () => {
    openGuide({ userAgent: UA.androidWhatsApp });
    cy.get("#guideSub").should("have.text", "You're inside another app's browser, which can't install apps.");
    cy.get("#installGuide").should("contain.text", "Open this page in Chrome");
    cy.get("#guideCopy").should("be.visible");
  });

  it("desktop Firefox is pointed to Chrome or Edge", () => {
    openGuide({ userAgent: UA.desktopFirefox });
    cy.get("#guideSub").should("have.text", "Firefox on computers can't install apps.");
  });

  it("Got it closes the guide", () => {
    openGuide({ userAgent: UA.androidChrome });
    cy.get("#guideClose").click();
    cy.get("#installGuide").should("not.be.visible");
  });
});

describe("Installable app files", () => {
  it("manifest is valid and its icons exist", () => {
    cy.request("/manifest.webmanifest").then(({ body }) => {
      const m = typeof body === "string" ? JSON.parse(body) : body;
      expect(m).to.include({ short_name: "Kata", display: "standalone", start_url: "/" });
      expect(m.icons.map((i) => i.sizes)).to.include.members(["192x192", "512x512"]);
      m.icons.forEach((icon) => {
        cy.request("/" + icon.src).its("headers").its("content-type").should("eq", "image/png");
      });
    });
  });

  it("service worker is served and never caches /api", () => {
    cy.request("/sw.js").its("body").should("include", 'const CACHE = "kata-').and("include", 'startsWith("/api/")');
  });
});
