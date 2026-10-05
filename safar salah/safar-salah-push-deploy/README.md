# Safar Salah (private)

- `public/` – the website (index.html, sw.js, icons, terms, privacy …)
- `worker.js` – serves the site and sends prayer notifications every minute
- `wrangler.jsonc` – Cloudflare settings (KV id, cron, custom domain)

Update the app: replace files in `public/` and commit. Cloudflare redeploys in about a minute.
Never commit the private push key. It lives in Cloudflare as the secret `VAPID_PRIVATE_JWK`.
