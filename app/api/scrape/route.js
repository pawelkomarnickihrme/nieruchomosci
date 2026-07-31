import { revalidateTag } from "next/cache";
import { scrape, storeName } from "../../../scraper.js";

export const maxDuration = 300;

export async function GET(req) {
  const q = new URL(req.url).searchParams;
  try {
    const items = await scrape(q.get("portal"), q.get("url"));
    const file = storeName(q.get("portal"), q.get("url"));
    revalidateTag(`store-${file}`, "max"); // swiezy scrape uniewaznia cache /api/load
    return Response.json({ file, items }); // file odsyla od razu — klient nie musi go szukac w /api/history
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}
