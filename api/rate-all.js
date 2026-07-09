import { rateAll } from "../scraper.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Tylko POST." });
    const { file, requirements } = req.body || {};
    if (!requirements || !requirements.trim()) return res.status(400).json({ error: "Brak wymagań." });
    if (!/^[a-z0-9._-]+\.json$/i.test(file || "")) return res.status(400).json({ error: "Zła nazwa pliku." });
    res.status(200).setHeader("content-type", "application/x-ndjson; charset=utf-8");
    await rateAll(file, requirements, { onRated: (m) => res.write(JSON.stringify(m) + "\n") });
    res.end();
  } catch (e) {
    if (res.headersSent) res.end(JSON.stringify({ error: String(e.message || e) }) + "\n");
    else res.status(502).json({ error: String(e.message || e) });
  }
}
