import { loadHistoryFile } from "../scraper.js";

export default async function handler(req, res) {
  try {
    res.json(await loadHistoryFile(req.query.file));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
}
