import { revalidateTag } from "next/cache";
import { scrape, storeName } from "../../../scraper.js";

export const maxDuration = 300;

export async function GET(req) {
  const q = new URL(req.url).searchParams;
  try {
    const items = await scrape(q.get("portal"), q.get("url"));
    revalidateTag(`store-${storeName(q.get("portal"), q.get("url"))}`, "max"); // swiezy scrape uniewaznia cache /api/load
    return Response.json(items);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}
