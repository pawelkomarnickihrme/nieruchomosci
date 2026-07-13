import { cacheLife, cacheTag } from "next/cache";
import { loadHistoryFile } from "../../../scraper.js";

// Oferty per plik w cache Nexta — otwarcie wyszukiwania nie odpytuje Upstasha za kazdym razem.
// Tag store-<plik> inwalidowany po scrape i rate-all.
async function cachedLoad(file) {
  "use cache";
  cacheLife("hours");
  cacheTag(`store-${file}`);
  return loadHistoryFile(file);
}

export async function GET(req) {
  const file = new URL(req.url).searchParams.get("file");
  // walidacja przed "use cache" — blad rzucony w srodku Next maskuje jako blad renderu
  if (!/^[a-z0-9._-]+\.json$/i.test(file || "")) return Response.json({ error: "Zla nazwa pliku." }, { status: 400 });
  return Response.json(await cachedLoad(file));
}
