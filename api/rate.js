import { offerDetails, saveRating } from "../scraper.js";
import { rateOffer } from "../rate.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Tylko POST." });
    const { offer, requirements } = req.body || {};
    const details = offer?.url ? await offerDetails(offer.url) : null;
    // NDJSON stream: linie {partial} w trakcie generowania, ostatnia linia = pelna ocena.
    res.status(200).setHeader("content-type", "application/x-ndjson; charset=utf-8");
    const rating = await rateOffer({ ...offer, ...details }, requirements, (p) =>
      res.write(JSON.stringify({ partial: p }) + "\n")
    );
    await saveRating(offer, rating, requirements);
    res.end(JSON.stringify(rating) + "\n");
  } catch (e) {
    if (res.headersSent) res.end(JSON.stringify({ error: String(e.message || e) }) + "\n");
    else res.status(502).json({ error: String(e.message || e) });
  }
}
