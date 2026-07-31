import { getAnalysis, createAnalysis, cloneAnalysis, updateAnalysis, loadRatings } from "../../../scraper.js";
import { whoami } from "../../../whoami.js";

// GET ?id= — publiczny podglad analizy: wymagania wlasciciela + jego oceny, tylko do odczytu.
// Nie zaklada odbiorcy konta goscia; `mine` mowi UI, czy pokazac edycje czy baner z klonowaniem.
export async function GET(req) {
  const id = new URL(req.url).searchParams.get("id");
  const an = await getAnalysis(id);
  if (!an) return Response.json({ error: "Nie ma takiej analizy." }, { status: 404 });
  const { id: me } = await whoami({ create: false });
  return Response.json({
    analysis: { id: an.id, file: an.file, portal: an.portal, url: an.url, count: an.count, title: an.title, requirements: an.requirements, at: an.at },
    ratings: await loadRatings(an.file, an.requirements),
    mine: !!me && me === an.owner,
  });
}

// POST ?clone=<id> — kopia cudzej analizy na wlasnosc klikajacego (oryginal nietkniety).
// POST bez clone — nowa analiza z wyniku scrape'a.
export async function POST(req) {
  const clone = new URL(req.url).searchParams.get("clone");
  const { id: owner } = await whoami();
  try {
    if (clone) return Response.json(await cloneAnalysis(clone, owner));
    const e = await req.json().catch(() => ({}));
    // tylko znane pola — analiza to nasz wpis, nie worek na dowolny JSON od klienta
    return Response.json(await createAnalysis({
      owner,
      file: e.file,
      requirements: String(e.requirements || ""),
      portal: String(e.portal || ""),
      url: String(e.url || ""),
      count: +e.count || 0,
      title: String(e.title || ""),
    }));
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 400 });
  }
}

// PATCH ?id= — zapis wymagan przez wlasciciela. Cudza analiza odbija sie o sprawdzenie w scraper.js.
export async function PATCH(req) {
  const id = new URL(req.url).searchParams.get("id");
  const { requirements } = await req.json().catch(() => ({}));
  const { id: owner } = await whoami();
  try {
    return Response.json(await updateAnalysis(id, owner, { requirements: String(requirements || "") }));
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 403 });
  }
}
