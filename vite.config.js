import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { scrape, listHistory, loadHistoryFile, saveRating, offerDetails, rateAll } from "./scraper.js";
import { rateOffer } from "./rate.js";

// Middleware /api/scrape — scrapowanie po stronie serwera (browser nie moze przez CORS).
// Dziala w `vite` (dev) i `vite preview`.
function scrapeApi() {
  const handler = (server) => {
    server.middlewares.use("/api/scrape", async (req, res) => {
      const send = (code, obj) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(obj));
      };
      try {
        const q = new URL(req.url, "http://x").searchParams;
        send(200, await scrape(q.get("portal"), q.get("url")));
      } catch (e) {
        send(502, { error: String(e.message || e) });
      }
    });
    server.middlewares.use("/api/history", async (req, res) => {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(await listHistory()));
    });
    server.middlewares.use("/api/load", async (req, res) => {
      const send = (code, obj) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(obj));
      };
      try {
        const file = new URL(req.url, "http://x").searchParams.get("file");
        send(200, await loadHistoryFile(file));
      } catch (e) {
        send(400, { error: String(e.message || e) });
      }
    });
    server.middlewares.use("/api/rate-all", async (req, res) => {
      const send = (code, obj) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(obj));
      };
      try {
        if (req.method !== "POST") return send(405, { error: "Tylko POST." });
        let body = "";
        for await (const chunk of req) body += chunk;
        const { file, requirements } = JSON.parse(body || "{}");
        if (!requirements || !requirements.trim()) return send(400, { error: "Brak wymagań." });
        if (!/^[a-z0-9._-]+\.json$/i.test(file || "")) return send(400, { error: "Zła nazwa pliku." });
        // NDJSON stream: jedna linia = jedna oceniona oferta (postep + wynik na zywo).
        res.statusCode = 200;
        res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
        await rateAll(file, requirements, { onRated: (m) => res.write(JSON.stringify(m) + "\n") });
        res.end();
      } catch (e) {
        if (res.headersSent) res.end(JSON.stringify({ error: String(e.message || e) }) + "\n");
        else send(502, { error: String(e.message || e) });
      }
    });
    server.middlewares.use("/api/rate", async (req, res) => {
      const send = (code, obj) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(obj));
      };
      try {
        if (req.method !== "POST") return send(405, { error: "Tylko POST." });
        let body = "";
        for await (const chunk of req) body += chunk;
        const { offer, requirements } = JSON.parse(body || "{}");
        const details = offer?.url ? await offerDetails(offer.url) : null;
        // NDJSON stream: linie {partial} w trakcie generowania, ostatnia linia = pelna ocena.
        res.statusCode = 200;
        res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
        const rating = await rateOffer({ ...offer, ...details }, requirements, (p) =>
          res.write(JSON.stringify({ partial: p }) + "\n")
        );
        await saveRating(offer, rating, requirements);
        res.end(JSON.stringify(rating) + "\n");
      } catch (e) {
        if (res.headersSent) res.end(JSON.stringify({ error: String(e.message || e) }) + "\n");
        else send(502, { error: String(e.message || e) });
      }
    });
  };
  return {
    name: "scrape-api",
    configureServer: handler,
    configurePreviewServer: handler,
  };
}

export default defineConfig(({ mode }) => {
  // .env -> process.env, aby middleware serwera (rate.js) widzial DEEPSEEK_API_KEY.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), scrapeApi()] };
});
