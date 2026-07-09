import { listHistory } from "../scraper.js";

export default async function handler(req, res) {
  res.json(await listHistory());
}
