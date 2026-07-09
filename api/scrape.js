import { scrape } from "../scraper.js";

export default async function handler(req, res) {
  try {
    res.json(await scrape(req.query.portal, req.query.url));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
