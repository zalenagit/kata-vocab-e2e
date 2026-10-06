/**
 * Test doubles for everything Kata gets from the browser or the Claude runtime:
 *   - window.claude.use("sample" | "user" | "db") -> fake translator, fake profile, no db
 *     (pass { claude: false } to test the standalone version, where window.claude doesn't exist)
 *     (so saved words go to localStorage and tests stay deterministic)
 *   - speechSynthesis   -> records what would be spoken in window.__spoken
 *   - SpeechRecognition -> replays transcripts from window.__speechQueue
 *
 * IMPORTANT: installKataMocks must stay self-contained (no outside variables),
 * because Playwright serialises it into the page with addInitScript.
 * Cypress calls it directly from onBeforeLoad(win).
 */
function installKataMocks(win, config) {
  const cfg = Object.assign(
    { claude: true, name: "Zalina Yusop", sample: true, sampleError: null, speechRecognition: true, speech: [], seedWords: null },
    config || {}
  );

  // Fake dictionary, keyed by "word|Target language name".
  const DICT = {
    "hello|Malay": {
      translation: "helo", romanization: "", partOfSpeech: "interjection",
      meaning: "A word used to greet someone.", example: "Hello, how are you?",
      exampleTranslation: "Helo, apa khabar?", alternatives: ["hai", "salam"]
    },
    "thank you|Malay": {
      translation: "terima kasih", romanization: "", partOfSpeech: "phrase",
      meaning: "Said to show you are grateful.", example: "Thank you for the tea.",
      exampleTranslation: "Terima kasih atas teh itu.", alternatives: []
    },
    "water|Japanese": {
      translation: "水", romanization: "mizu", partOfSpeech: "noun",
      meaning: "The clear liquid you drink.", example: "I drink water.",
      exampleTranslation: "私は水を飲みます。", alternatives: []
    },
    "<img src=x onerror=window.__xss=1>|Malay": {
      translation: "<b onmouseover=window.__xss=2>bold</b>", romanization: "", partOfSpeech: "",
      meaning: "<script>window.__xss=3</script>", example: "", exampleTranslation: "", alternatives: []
    }
  };

  // Seed saved words once per test (not again on reload).
  try {
    if (cfg.seedWords && !win.sessionStorage.getItem("kata-seeded")) {
      win.localStorage.setItem("kata-words", JSON.stringify(cfg.seedWords));
      win.sessionStorage.setItem("kata-seeded", "1");
    }
  } catch (e) {}

  // Keep the service worker out of tests so every run sees fresh files.
  win.__KATA_NO_SW = true;

  // ---- Claude runtime (claude: false = the standalone/Cloudflare version) ----
  win.__sampleCalls = [];
  const sample = async (input) => ({ text: String(input), truncated: false });
  sample.json = async (prompt) => {
    win.__sampleCalls.push(prompt);
    if (cfg.sampleError) throw { code: cfg.sampleError, message: "mocked " + cfg.sampleError };
    const word = (prompt.match(/Word: """([\s\S]*?)"""/) || [])[1] || "";
    const target = (prompt.match(/into (.+?)\.\n/) || [])[1] || "";
    const hit = DICT[word.toLowerCase() + "|" + target];
    if (!hit) throw { code: "error", message: "no mock translation for " + word + " -> " + target };
    return JSON.parse(JSON.stringify(hit));
  };
  const user = {
    me: async () => ({ id: "u-test", name: cfg.name || "", email: null }),
    id: async () => "u-test",
    isOwner: () => true,
    canEdit: () => true
  };
  if (cfg.claude) win.claude = {
    use: async (name) => {
      if (name === "sample") return cfg.sample ? sample : null;
      if (name === "user") return user;
      return null; // "db" -> null, so the app falls back to localStorage
    }
  };

  // ---- Speech out ----
  win.__spoken = [];
  if (typeof win.SpeechSynthesisUtterance !== "function") {
    win.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ""; };
  }
  Object.defineProperty(win, "speechSynthesis", {
    configurable: true,
    value: {
      speak: (u) => win.__spoken.push({ text: u.text, lang: u.lang }),
      cancel: () => {},
      getVoices: () => [],
      onvoiceschanged: null
    }
  });

  // ---- Speech in ----
  win.__speechQueue = (cfg.speech || []).slice();
  if (cfg.speechRecognition) {
    class FakeRecognition {
      start() {
        setTimeout(() => {
          const said = win.__speechQueue.shift();
          if (said === undefined) { if (this.onerror) this.onerror({ error: "no-speech" }); }
          else if (this.onresult) this.onresult({ results: [[{ transcript: said }]] });
          if (this.onend) this.onend();
        }, 50);
      }
      stop() { if (this.onend) this.onend(); }
    }
    Object.defineProperty(win, "SpeechRecognition", { configurable: true, writable: true, value: FakeRecognition });
    Object.defineProperty(win, "webkitSpeechRecognition", { configurable: true, writable: true, value: FakeRecognition });
  } else {
    Object.defineProperty(win, "SpeechRecognition", { configurable: true, writable: true, value: undefined });
    Object.defineProperty(win, "webkitSpeechRecognition", { configurable: true, writable: true, value: undefined });
  }
}

function seedWords() {
  const now = Date.now();
  return [
    { id: "w1", text: "hello", from: "en-US", to: "ms-MY", translation: "helo", romanization: "", partOfSpeech: "interjection",
      meaning: "A greeting.", example: "Hello!", exampleTranslation: "Helo!", box: 0, due: now - 1000, added: now - 2000 },
    { id: "w2", text: "thank you", from: "en-US", to: "ms-MY", translation: "terima kasih", romanization: "", partOfSpeech: "phrase",
      meaning: "Gratitude.", example: "Thank you!", exampleTranslation: "Terima kasih!", box: 0, due: now - 1000, added: now - 1000 }
  ];
}

module.exports = { installKataMocks, seedWords };
