import { revalidateTag } from "next/cache";
import { scrape, storeName } from "../../../scraper.js";

export const maxDuration = 300;

export async function GET(req) {
  const q = new URL(req.url).searchParams;
  try {
    const { store, added, dropped } = await scrape(q.get("portal"), q.get("url"));
    const file = storeName(q.get("portal"), q.get("url"));
    revalidateTag(`store-${file}`, "max"); // swiezy scrape uniewaznia cache /api/load
    // file odsyla od razu — klient nie musi go szukac. added/dropped to material pod monitoring.
    return Response.json({ file, items: store, added: added.length, dropped: dropped.length });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}
