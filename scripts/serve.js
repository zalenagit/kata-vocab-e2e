// Tiny zero-dependency static server for the app under test.
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "app");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml"
};
// Note: /api/translate only exists on Cloudflare. Use `npm run dev` (wrangler) to run it locally.

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}).listen(port, () => console.log(`Kata running at http://localhost:${port}`));
