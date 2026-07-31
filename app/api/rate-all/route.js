import { rateAll } from "../../../scraper.js";

export const maxDuration = 300;

// Limit funkcji jest twardy, a pelne ocenianie duzego miasta trwa dluzej niz on pozwala.
// Zamiast dac sie sciac w polowie batcha, konczymy sami z zapasem na zapis warstwy ocen
// i domkniecie strumienia — i mowimy klientowi wprost, ile zostalo.
const MARGIN_MS = 30_000;

export async function POST(req) {
  const deadline = Date.now() + maxDuration * 1000 - MARGIN_MS;
  const { file, requirements } = await req.json().catch(() => ({}));
  if (!requirements || !requirements.trim()) return Response.json({ error: "Brak wymagań." }, { status: 400 });
  if (!/^[a-z0-9._-]+\.json$/i.test(file || "")) return Response.json({ error: "Zła nazwa pliku." }, { status: 400 });

  // NDJSON stream: linia po kazdej ocenionej ofercie, na koniec podsumowanie z informacja
  // o ewentualnym urwaniu. Blad tez leci jako linia — naglowki juz poszly, wiec status nie zadziala.
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (m) => c.enqueue(enc.encode(JSON.stringify(m) + "\n"));
      try {
        const { done, total, left, truncated } = await rateAll(file, requirements, { onRated: send, deadline });
        send({ finished: true, done, total, left, truncated });
      } catch (e) {
        send({ error: String(e.message || e) });
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}
