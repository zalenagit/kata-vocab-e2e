// The standalone version (Cloudflare Pages): no Claude runtime, translation via /api/translate.
const { installKataMocks } = require("../../tests/support/kata-mocks");

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

  it("install button stays hidden until the browser offers install", () => {
    visitStandalone();
    cy.get("#installBtn").should("not.be.visible");
    cy.window().then((win) => {
      const e = new win.Event("beforeinstallprompt", { cancelable: true });
      e.prompt = cy.stub().as("prompt");
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      win.dispatchEvent(e);
    });
    cy.get("#installBtn").should("be.visible").click();
    cy.get("@prompt").should("have.been.calledOnce");
    cy.get("#installBtn").should("not.be.visible");
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
