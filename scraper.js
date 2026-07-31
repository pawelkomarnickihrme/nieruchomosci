// Scraper ogloszen -> tablica obiektow. Node 18+ (globalne fetch), zero zaleznosci.
// CLI:  node scraper.js olx "https://www.olx.pl/nieruchomosci/mieszkania/wynajem/warszawa/"

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "Accept-Language": "pl-PL,pl;q=0.9",
};

const BASE = {
  olx: "https://www.olx.pl",
  otodom: "https://www.otodom.pl",
  allegro: "https://allegrolokalnie.pl",
  komornik: "https://licytacje.komornik.pl",
};
export const PORTALS = Object.keys(BASE);

async function fetchHtml(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} — portal zablokowal zadanie albo zly URL.`);
  return r.text();
}

// Stan JSON osadzony w HTML: __NEXT_DATA__ (Otodom) lub __PRERENDERED_STATE__ (OLX, string-w-stringu).
function embeddedData(html) {
  let m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) return JSON.parse(m[1]);
  m = html.match(/window\.__PRERENDERED_STATE__\s*=\s*("[\s\S]*?");\s*window\./);
  if (m) return JSON.parse(JSON.parse(m[1]));
  return null;
}

// Rekurencyjnie zbiera obiekty wygladajace na ogloszenie — odporne na zmiany sciezek w JSON.
function findListings(node, out) {
  if (Array.isArray(node)) {
    for (const v of node) findListings(v, out);
  } else if (node && typeof node === "object") {
    const title = node.title || node.name;
    const hasPrice = ["price", "totalPrice", "priceInfo"].some((k) => k in node);
    const hasRef = ["url", "id", "slug"].some((k) => k in node);
    if (typeof title === "string" && title && (hasPrice || hasRef)) {
      out.push(node);
      return; // nie schodz glebiej w rozpoznane ogloszenie
    }
    for (const v of Object.values(node)) findListings(v, out);
  }
}

function flattenPrice(p) {
  if (p && typeof p === "object") {
    for (const k of ["value", "amount", "regularPrice", "displayValue"])
      if (k in p) return flattenPrice(p[k]);
    return null;
  }
  return p ?? null;
}

function normalize(raw, base) {
  let url = raw.url || raw.slug;
  if (url && url.startsWith("/")) url = base.replace(/\/$/, "") + url;
  const loc = raw.location;
  const ph = raw.photos?.[0] ?? raw.images?.[0]; // OLX: string, Otodom: obiekt
  return {
    title: raw.title || raw.name || null,
    price: flattenPrice(raw.price || raw.totalPrice || raw.priceInfo),
    url: url || null,
    location: loc && typeof loc === "object" ? loc.cityName ?? null : loc ?? null,
    id: raw.id ?? null,
    photo: (typeof ph === "string" ? ph : ph?.medium || ph?.large || ph?.url) ?? null,
  };
}

async function scrapeNextPage(url, base, seen, res) {
  const data = embeddedData(await fetchHtml(url));
  if (!data) throw new Error("Brak osadzonych danych — portal zmienil strukture lub blokuje.");
  const found = [];
  findListings(data, found);
  let added = 0;
  for (const r of found) {
    const n = normalize(r, base);
    const key = n.id || n.url;
    if (!key || seen.has(key) || !(n.title && n.price != null)) continue;
    seen.add(key);
    res.push(n);
    added++;
  }
  return added;
}

async function scrapeNext(url, base, maxPages = 25) {
  const seen = new Set(), res = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(url);
    if (page > 1) u.searchParams.set("page", page);
    // Brak nowych ogloszen = koniec stronicowania (lub ostatnia strona zawija sie do pierwszej).
    if ((await scrapeNextPage(u.href, base, seen, res)) === 0) break;
  }
  return res;
}

// ponytail: naiwne parsowanie <a> po tytule. Cloudflare/JS (allegro/komornik) zwroci pusto.
// Gdy przestanie wystarczac -> playwright.
async function scrapeGeneric(url, base) {
  const html = await fetchHtml(url);
  const res = [], seen = new Set();
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length < 15 || seen.has(href)) continue;
    if (href.startsWith("/")) href = base.replace(/\/$/, "") + href;
    seen.add(href);
    res.push({ title: text, price: null, url: href, location: null, id: null });
  }
  return res;
}

// Trwaly store: jeden JSON na (portal + url), aby rozne miasta sie nie mieszaly.
// Lokalnie pliki w data/, na Vercelu Upstash Redis (env z integracji Marketplace).
const DATA_DIR = process.env.VERCEL ? "/tmp/data" : join(dirname(fileURLToPath(import.meta.url)), "data");
const MANIFEST = "_index.json";
const key = (n) => n.id || n.url;
const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; } };

const useRedis = () => !!process.env.KV_REST_API_URL;
let redis;
async function kv() {
  if (!redis) {
    const { Redis } = await import("@upstash/redis");
    redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  }
  return redis;
}
async function getJson(name, fallback) {
  if (useRedis()) return (await (await kv()).get(`nieruchomosci:${name}`)) ?? fallback;
  return readJson(join(DATA_DIR, name), fallback);
}
async function setJson(name, val) {
  if (useRedis()) { await (await kv()).set(`nieruchomosci:${name}`, val); return; }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, name), JSON.stringify(val, null, 2));
}
// Nazwy wpisow zaczynajace sie od prefiksu. Potrzebne migracji, a w fali 2 cronowi,
// ktory musi przejsc po wszystkich analizach z wlaczonym monitoringiem.
export async function listKeys(prefix = "") {
  if (useRedis()) {
    const ks = await (await kv()).keys(`nieruchomosci:${prefix}*`);
    return ks.map((k) => k.replace(/^nieruchomosci:/, ""));
  }
  try {
    return readdirSync(DATA_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  } catch {
    return [];
  }
}

// Niski poziom dostepu do store'u — dla migracji i skryptow, nie dla sciezki zadania.
export { getJson as readData, setJson as writeData };

export function storeName(portal, url) {
  const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/,"").slice(0, 80);
  return `${portal}-${slug}.json`;
}

// --- Analizy ---------------------------------------------------------------
// Store ofert jest wspolny dla wszystkich (te same ogloszenia OLX), ale wymagania i oceny
// naleza do konkretnej osoby. Analiza spina jedno z drugim: wyszukiwanie + moje wymagania.
// Id jest losowe i nieodgadywalne — adres /a/<id> dziala jak link do udostepnienia.
const anFile = (id) => `an-${id}.json`;
const AN_ID = /^[a-z0-9]{8,32}$/i;

export const getAnalysis = (id) => (AN_ID.test(id || "") ? getJson(anFile(id), null) : Promise.resolve(null));

export async function createAnalysis({ owner, file, requirements = "", portal = "", url = "", count = 0, title = "" }) {
  if (!/^[a-z0-9._-]+\.json$/i.test(file || "")) throw new Error("Zla nazwa pliku.");
  const an = { id: randomUUID().replace(/-/g, "").slice(0, 12), owner, file, requirements, portal, url, count, title, at: Date.now() };
  await setJson(anFile(an.id), an);
  await pushHistory(owner, an);
  return an;
}

// Klonowanie udostepnionej analizy: te same oferty i wymagania, ale wlasnosc klikajacego.
// Oryginal zostaje nietkniety, a warstwa ocen trafia sie z cache (ten sam odcisk wymagan).
export async function cloneAnalysis(id, owner) {
  const src = await getAnalysis(id);
  if (!src) throw new Error("Nie ma takiej analizy.");
  return createAnalysis({ ...src, owner });
}

export async function updateAnalysis(id, owner, patch) {
  const an = await getAnalysis(id);
  if (!an) throw new Error("Nie ma takiej analizy.");
  if (an.owner !== owner) throw new Error("To nie Twoja analiza.");
  Object.assign(an, patch, { id: an.id, owner: an.owner });
  await setJson(anFile(an.id), an);
  await pushHistory(owner, an);
  return an;
}

// Lista analiz per tozsamosc (konto Google albo gosc z ciasteczka). Trzymana w calosci,
// zeby pasek boczny renderowal sie z jednego odczytu zamiast N zapytan o kazda analize.
const histFile = (id) => `hist-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;

export const historyOf = (id) => getJson(histFile(id), []);

export async function pushHistory(id, an) {
  const row = { id: an.id, file: an.file, portal: an.portal, url: an.url, count: an.count, title: an.title, at: an.at };
  const rows = [row, ...(await historyOf(id)).filter((x) => x.id !== row.id)];
  await setJson(histFile(id), rows);
  return rows;
}

// Oferty jednego wyszukiwania. Nazwa pliku przychodzi od klienta, wiec guard na traversal.
export async function loadStore(file) {
  if (!/^[a-z0-9._-]+\.json$/i.test(file)) throw new Error("Zla nazwa pliku.");
  return getJson(file, []);
}

// Szczegoly z pojedynczej oferty (opis + parametry) — listing sam tego nie ma, a AI tego potrzebuje.
export async function offerDetails(url) {
  try {
    const data = embeddedData(await fetchHtml(url));
    if (!data) return null;
    let hit;
    (function walk(n) {
      if (hit || !n || typeof n !== "object") return;
      if (typeof n.description === "string" && Array.isArray(n.params)) { hit = n; return; }
      for (const v of Object.values(n)) walk(v);
    })(data);
    if (!hit) return null;
    return {
      description: hit.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000),
      params: hit.params.map((p) => `${p.name}: ${p.value}`),
    };
  } catch {
    return null;
  }
}

// --- Warstwa ocen ----------------------------------------------------------
// Oceny mieszkaja poza store'em ofert, kluczowane (store + odcisk wymagan). Dzieki temu
// dwie osoby patrzace na to samo miasto nie nadpisuja sobie wynikow ani nie widza swoich
// kryteriow — a identyczne wymagania trafiaja w gotowe oceny zamiast placic za nie drugi raz.
export const ratingsKey = (file, requirements) =>
  `rate-${file.replace(/\.json$/i, "")}-${createHash("sha256").update(requirements.trim()).digest("hex").slice(0, 12)}.json`;

export async function loadRatings(file, requirements) {
  if (!requirements?.trim()) return {};
  if (!/^[a-z0-9._-]+\.json$/i.test(file || "")) throw new Error("Zla nazwa pliku.");
  return (await getJson(ratingsKey(file, requirements), null))?.byKey ?? {};
}

// Ocena wszystkich ofert z pliku — batchami po `concurrency`, wznawialna (pomija juz ocenione).
// onRated({ key, rating, done, total }) wolane po kazdej ofercie -> streaming do UI. Zapis co batch.
// deadline: znacznik czasu, po ktorym przerywamy i oddajemy truncated — limit funkcji na Vercelu
// jest twardy (300 s na Hobby), a pelne ocenianie duzego miasta trwa dluzej. Reszta doliczy sie
// przy kolejnym uruchomieniu, bo warstwa ocen jest zapisywana po kazdym batchu.
export async function rateAll(file, requirements, { concurrency = 5, onRated, deadline } = {}) {
  if (!requirements || !requirements.trim()) throw new Error("Brak wymagań.");
  const { rateOffer } = await import("./rate.js");
  const store = await loadStore(file); // waliduje nazwe pliku
  const rkey = ratingsKey(file, requirements);
  const layer = (await getJson(rkey, null)) ?? { requirements, at: Date.now(), byKey: {} };
  layer.byKey ??= {};
  const todo = store.filter((it) => key(it) && !layer.byKey[key(it)]);
  const total = todo.length;
  let done = 0, truncated = false;
  for (let i = 0; i < todo.length; i += concurrency) {
    if (deadline && Date.now() >= deadline) { truncated = true; break; }
    await Promise.all(
      todo.slice(i, i + concurrency).map(async (it) => {
        const k = key(it);
        try {
          const details = it.url ? await offerDetails(it.url) : null;
          const r = await rateOffer({ ...it, ...details }, requirements);
          layer.byKey[k] = { score: r.score, reason: r.reason };
        } catch (e) {
          layer.byKey[k] = { error: String(e.message || e) };
        }
        onRated?.({ key: k, rating: layer.byKey[k], done: ++done, total });
      })
    );
    layer.at = Date.now();
    await setJson(rkey, layer);
  }
  return { byKey: layer.byKey, truncated, done, total, left: total - done };
}

// Scalanie swiezego pobrania ze store'em (mutuje store). Zwraca klucze nowych ofert i obnizek —
// monitoring w fali 2 stoi dokladnie na tym, a tutaj wychodzi za darmo przy okazji scalania.
// Wydzielone z scrape(), zeby dalo sie sprawdzic bez ruszania sieci.
export function mergeFresh(store, fresh, now = Date.now()) {
  const have = new Map(store.map((s) => [key(s), s]));
  const added = [], dropped = [];
  for (const n of fresh) {
    const k = key(n);
    if (!k) continue;
    const ex = have.get(k);
    if (!ex) {
      n.prices = n.price == null ? [] : [{ price: n.price, at: now }];
      have.set(k, n);
      store.push(n);
      added.push(k);
      continue;
    }
    ex.photo ??= n.photo; // stare wpisy sprzed zdjec dostaja fotke przy ponownym scrape
    // Historia cen — wpis tylko przy zmianie. Bez tego obnizka, czyli najsilniejszy sygnal
    // zakupowy, jest niewidoczna: cena zostaje zamrozona z pierwszego pobrania.
    if (n.price != null && n.price !== ex.price) {
      // at: 0 znaczy "data nieznana" — wpis sprzed wprowadzenia historii cen.
      ex.prices ??= ex.price == null ? [] : [{ price: ex.price, at: 0 }];
      ex.prices.push({ price: n.price, at: now });
      if (ex.price != null && n.price < ex.price) dropped.push(k);
      ex.price = n.price;
    }
  }
  return { added, dropped };
}

export async function scrape(portal, url) {
  if (!(portal in BASE)) throw new Error(`Nieznany portal: ${portal}`);
  if (!url) throw new Error("Brak URL.");
  const fresh = portal === "olx" || portal === "otodom"
    ? await scrapeNext(url, BASE[portal])
    : await scrapeGeneric(url, BASE[portal]);

  const name = storeName(portal, url);
  const store = await getJson(name, []);
  const { added, dropped } = mergeFresh(store, fresh);
  await setJson(name, store);
  const manifest = await getJson(MANIFEST, {});
  manifest[name] = { url, portal, count: store.length, title: store[0]?.title || name, at: Date.now() };
  await setJson(MANIFEST, manifest);
  return { store, added, dropped };
}

// Uruchomienie z CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , portal, url] = process.argv;
  if (!portal || !url) {
    console.error(`Uzycie: node scraper.js <${PORTALS.join("|")}> <url>`);
    process.exit(1);
  }
  scrape(portal, url)
    .then(({ store, added, dropped }) => {
      console.error(`${store.length} ofert (nowych: ${added.length}, obnizek: ${dropped.length})`);
      console.log(JSON.stringify(store, null, 2));
    })
    .catch((e) => {
      console.error("Blad:", e.message);
      process.exit(1);
    });
}
