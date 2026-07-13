import { revalidateTag } from "next/cache";
import { rateAll } from "../../../scraper.js";

export const maxDuration = 300;

export async function POST(req) {
  const { file, requirements } = await req.json().catch(() => ({}));
  if (!requirements || !requirements.trim()) return Response.json({ error: "Brak wymagań." }, { status: 400 });
  if (!/^[a-z0-9._-]+\.json$/i.test(file || "")) return Response.json({ error: "Zła nazwa pliku." }, { status: 400 });

  // NDJSON stream: linia po kazdej ocenionej ofercie, blad jako ostatnia linia (naglowki juz poszly).
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (m) => c.enqueue(enc.encode(JSON.stringify(m) + "\n"));
      try {
        await rateAll(file, requirements, { onRated: send });
        revalidateTag(`store-${file}`, "max"); // oceny zmienily plik — uniewaznij cache /api/load
      } catch (e) {
        send({ error: String(e.message || e) });
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}
