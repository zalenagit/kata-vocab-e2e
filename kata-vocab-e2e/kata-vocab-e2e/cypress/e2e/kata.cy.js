const { installKataMocks, seedWords } = require("../../tests/support/kata-mocks");

/** Visit Kata with the mocked Claude runtime and speech APIs.
 *  Use this instead of cy.reload(), because reload skips onBeforeLoad. */
const visitKata = (cfg = {}) =>
  cy.visit("/", { onBeforeLoad: (win) => installKataMocks(win, cfg) });

const translate = (word) => {
  cy.get("#wordInput").clear().type(word, { parseSpecialCharSequences: false });
  cy.get("#translateBtn").click();
};

describe("Greeting", () => {
  it("greets the viewer by first name", () => {
    visitKata();
    cy.get("#greet").should("have.text", "Hai, Zalina! What words do you want to translate today?");
  });

  it("falls back to a plain greeting and lets you set a name that sticks", () => {
    visitKata({ name: "" });
    cy.get("#greet").should("contain.text", "Hai! What words do you want to translate today?");
    cy.window().then((win) => cy.stub(win, "prompt").returns("Zee"));
    cy.contains("button", "Tell me your name").click();
    cy.get("#greet").should("have.text", "Hai, Zee! What words do you want to translate today?");
    visitKata({ name: "" });
    cy.get("#greet").should("contain.text", "Hai, Zee!");
  });
});

describe("Translate", () => {
  it("translates English to Malay with meaning, example and alternatives", () => {
    visitKata();
    translate("hello");
    cy.get("#resultBox .trans").should("have.text", "helo");
    cy.get("#resultBox")
      .should("contain.text", "A word used to greet someone.")
      .and("contain.text", "Helo, apa khabar?")
      .and("contain.text", "Also: hai, salam");
  });

  it("Enter key translates", () => {
    visitKata();
    cy.get("#wordInput").type("hello{enter}");
    cy.get("#resultBox .trans").should("have.text", "helo");
  });

  it("shows romanization for non-Latin scripts", () => {
    visitKata();
    cy.get("#toLang").select("ja-JP");
    translate("water");
    cy.get("#resultBox .trans").should("have.text", "水");
    cy.get("#resultBox .romaji").should("have.text", "mizu");
  });

  it("validates empty input and matching languages", () => {
    visitKata();
    cy.get("#translateBtn").click();
    cy.get("#addHint").should("have.text", "Type or say a word first.");
    cy.get("#toLang").select("en-US");
    translate("hello");
    cy.get("#addHint").should("have.text", "Pick two different languages.");
  });

  it("swap button reverses the language pair", () => {
    visitKata();
    cy.get("#swap").click();
    cy.get("#fromLang").should("have.value", "ms-MY");
    cy.get("#toLang").should("have.value", "en-US");
  });

  it("reads the word and translation aloud in the right languages", () => {
    visitKata();
    translate("hello");
    cy.get('[aria-label="Hear hello"]').click();
    cy.get('[aria-label="Hear the translation"]').click();
    cy.window().its("__spoken").should("deep.equal", [
      { text: "hello", lang: "en-US" },
      { text: "helo", lang: "ms-MY" }
    ]);
  });

  it("renders hostile text as plain text (no XSS)", () => {
    visitKata();
    const payload = "<img src=x onerror=window.__xss=1>";
    translate(payload);
    cy.get("#resultBox .word").should("have.text", payload);
    cy.get("#resultBox .trans").trigger("mouseover");
    cy.get("#resultBox img, #resultBox b, #resultBox script").should("not.exist");
    cy.window().then((win) => expect(win.__xss).to.be.undefined);
  });

  it("falls back to manual entry when Claude permission is declined", () => {
    visitKata({ sampleError: "not_granted" });
    translate("hello");
    cy.get("#manTrans").should("be.visible");
    cy.get("#saveBtn").click();
    cy.get("#addHint").should("have.text", "Add a translation before saving.");
    cy.get("#manTrans").type("helo");
    cy.get("#saveBtn").click();
    cy.get("#wordCount").should("have.text", "(1)");
  });

  it("shows a retry message when translation fails", () => {
    visitKata({ sampleError: "rate_limited" });
    translate("hello");
    cy.get("#addHint").should("have.text", "Too many lookups at once. Wait a moment, then try again.");
  });
});

describe("Voice input", () => {
  it("speaking a word fills the box and translates it", () => {
    visitKata({ speech: ["hello"] });
    cy.get("#micBtn").click();
    cy.get("#wordInput").should("have.value", "hello");
    cy.get("#resultBox .trans").should("have.text", "helo");
  });

  it("silence gives a helpful message", () => {
    visitKata({ speech: [] });
    cy.get("#micBtn").click();
    cy.get("#addHint").should("have.text", "Didn't hear anything. Tap the mic and try again.");
  });

  it("unsupported browsers are told to type instead", () => {
    visitKata({ speechRecognition: false });
    cy.get("#micBtn").click();
    cy.get("#addHint").should("contain.text", "Voice input isn't supported in this browser.");
  });
});

describe("Saving words", () => {
  it("saves a word, keeps it after reload, and updates instead of duplicating", () => {
    visitKata();
    translate("hello");
    cy.get("#saveBtn").click();
    cy.get("#addHint").should("contain.text", "Saved “hello”");
    cy.get("#wordCount").should("have.text", "(1)");

    translate("Hello");
    cy.get("#saveBtn").click();
    cy.get("#addHint").should("contain.text", "Updated “Hello”");
    cy.get("#wordCount").should("have.text", "(1)");

    visitKata();
    cy.get("#wordCount").should("have.text", "(1)");
  });
});

describe("My words", () => {
  it("lists, searches and deletes words", () => {
    visitKata({ seedWords: seedWords() });
    cy.get("#tab-list").click();
    cy.get("ul.words li").should("have.length", 2);

    cy.get("#search").type("terima");
    cy.get("ul.words li").should("have.length", 1);
    cy.get("#search").clear().type("zzz");
    cy.get("#listBox").should("contain.text", "No words match");
    cy.get("#search").clear();

    // Cypress auto-accepts window.confirm
    cy.get('[aria-label="Delete hello"]').click();
    cy.get("ul.words li").should("have.length", 1);
    cy.get("#wordCount").should("have.text", "(1)");
  });

  it("empty notebook invites you to add a word", () => {
    visitKata();
    cy.get("#tab-list").click();
    cy.get("#listBox").should("contain.text", "Your notebook is empty");
  });
});

describe("Flashcards", () => {
  it("empty deck state", () => {
    visitKata();
    cy.get("#tab-practice").click();
    cy.get("#practiceBox").should("contain.text", "No words yet");
  });

  it("flip, grade, and requeue a missed card", () => {
    visitKata({ seedWords: seedWords() });
    cy.get("#dueCount").should("have.text", "(2)");
    cy.get("#tab-practice").click();
    cy.get("#practiceBox").should("contain.text", "Card 1 of 2");

    cy.get("#grade").should("not.be.visible");
    cy.get("#card .face.front .word").click();
    cy.get("#card").should("have.class", "flipped");
    cy.get("#gotBtn").click();

    cy.get("#practiceBox").should("contain.text", "Card 2 of 2");
    cy.get("#card").focus().type(" ");
    cy.get("#againBtn").click();

    // A missed card comes back at the end of the round.
    cy.get("#practiceBox").should("contain.text", "Card 3 of 3");
    cy.get("#card").focus().type(" ");
    cy.get("#card").type("2"); // shortcut for Got it
    cy.get("#practiceBox").should("contain.text", "Round finished");
    cy.get("#dueCount").should("have.text", "");
  });

  it("reverse mode shows the Malay side first", () => {
    visitKata({ seedWords: seedWords() });
    cy.get("#tab-practice").click();
    cy.get("#revToggle").check();
    cy.get("#card .face.front p").invoke("text").should("be.oneOf", ["helo", "terima kasih"]);
  });

  it("say-it check passes for the right word and fails for the wrong one", () => {
    visitKata({ seedWords: seedWords() });
    cy.get("#tab-practice").click();
    cy.get("#card .face.back .trans").invoke("text").then((answer) => {
      cy.window().then((win) => win.__speechQueue.push(answer, "something else"));
    });
    cy.get("#card .face.front .word").click();
    cy.get("#sayIt").click({ force: true });
    cy.get("#sayResult").should("contain.text", "Nice");
    cy.get("#sayIt").click({ force: true });
    cy.get("#sayResult").should("contain.text", "Heard “something else”");
  });
});

describe("Layout", () => {
  it("no horizontal scroll on a phone screen", () => {
    cy.viewport(360, 740);
    visitKata({ seedWords: seedWords() });
    translate("thank you");
    cy.get("#resultBox .trans").should("have.text", "terima kasih");
    cy.document().then((doc) => {
      expect(doc.documentElement.scrollWidth).to.be.at.most(doc.defaultView.innerWidth);
    });
  });
});
