/**
 * Cloudflare Worker entry point.
 * Static files in ./app are served automatically (see wrangler.jsonc "assets").
 * The Worker only runs for paths that aren't a static file, which is how /api/translate gets here.
 */
import { onRequestGet } from "../functions/api/translate.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/translate") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Use GET." }), {
          status: 405,
          headers: { Allow: "GET", "Content-Type": "application/json; charset=utf-8" }
        });
      }
      return onRequestGet({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    return env.ASSETS.fetch(request);
  }
};
