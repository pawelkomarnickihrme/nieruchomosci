import { cookies } from "next/headers";
import { auth } from "../../../auth.js";
import { listHistory, historyOf, pushHistory } from "../../../scraper.js";
import { histSlug } from "../../../slug.js";

// Tozsamosc historii: mail zalogowanego albo konto goscia — losowy id w ciasteczku, zakladane przy
// pierwszym wejsciu. Dzieki temu anonim tez ma swoja historie w bazie, tyle ze zwiazana z przegladarka.
async function whoami() {
  const email = (await auth())?.user?.email;
  if (email) return { id: `user-${email}`, user: email };
  const jar = await cookies();
  let guest = jar.get("guest")?.value;
  if (!guest) {
    guest = crypto.randomUUID();
    jar.set("guest", guest, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return { id: `guest-${guest}`, user: null };
}

// ?slug=... — rozwiazanie udostepnionego linku, publiczne i bez zakladania konta goscia
// (store ofert jest wspolny dla wszystkich).
export async function GET(req) {
  const slug = new URL(req.url).searchParams.get("slug");
  if (slug) return Response.json((await listHistory()).find((h) => histSlug(h) === slug) ?? null);
  const { id, user } = await whoami();
  return Response.json({ user, rows: await historyOf(id) });
}

export async function POST(req) {
  const e = await req.json().catch(() => ({}));
  if (!/^[a-z0-9._-]+\.json$/i.test(e?.file || "")) return Response.json({ error: "Zla nazwa pliku." }, { status: 400 });
  // tylko znane pola — historia to nasz wpis, nie worek na dowolny JSON od klienta
  const entry = { file: e.file, portal: String(e.portal || ""), url: String(e.url || ""), count: +e.count || 0, title: String(e.title || ""), at: Date.now() };
  const { id } = await whoami();
  return Response.json(await pushHistory(id, entry));
}
