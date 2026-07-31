// Scraper ogloszen -> tablica obiektow. Node 18+ (globalne fetch), zero zaleznosci.
// CLI:  node scraper.js olx "https://www.olx.pl/nieruchomosci/mieszkania/wynajem/warszawa/"

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
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
async function listFiles() {
  if (useRedis()) return Object.keys(await getJson(MANIFEST, {}));
  try {
    return readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && f !== MANIFEST);
  } catch {
    return [];
  }
}

export function storeName(portal, url) {
  const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/,"").slice(0, 80);
  return `${portal}-${slug}.json`;
}

// Historia wyszukan z samego manifestu (count/title zapisywane przy scrape) — bez sciagania
// calych store'ow per wpis. Stare wpisy bez count/title dociagane i dopisywane raz.
export async function listHistory() {
  const manifest = await getJson(MANIFEST, {});
  // na Redisie lista plikow == klucze manifestu — nie czytaj go z sieci drugi raz przez listFiles()
  const files = useRedis() ? Object.keys(manifest) : await listFiles();
  let dirty = false;
  const rows = await Promise.all(
    files.map(async (f) => {
      const m = (manifest[f] ||= {});
      if (m.count == null || m.title == null) {
        const items = await getJson(f, []);
        m.count = items.length;
        m.title = items[0]?.title || f;
        dirty = true;
      }
      return { file: f, portal: m.portal || f.split("-")[0], url: m.url || "", count: m.count, title: m.title, at: m.at || 0 };
    })
  );
  if (dirty) await setJson(MANIFEST, manifest);
  return rows.sort((a, b) => b.at - a.at);
}

// Historia per tozsamosc (konto Google albo gosc z ciasteczka): jeden JSON obok store'ow ofert.
const histFile = (id) => `hist-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;

export const historyOf = (id) => getJson(histFile(id), []);

export async function pushHistory(id, entry) {
  const rows = [entry, ...(await historyOf(id)).filter((x) => x.file !== entry.file)];
  await setJson(histFile(id), rows);
  return rows;
}

export async function loadHistoryFile(file) {
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

// Ocena wszystkich ofert z pliku — batchami po `concurrency`, wznawialna (pomija ocenione dla tych samych wymagan).
// onRated({ key, rating, done, total }) wolane po kazdej ofercie -> streaming do UI. Zapis pliku co batch.
export async function rateAll(file, requirements, { concurrency = 5, onRated } = {}) {
  if (!requirements || !requirements.trim()) throw new Error("Brak wymagań.");
  const { rateOffer } = await import("./rate.js");
  const store = await loadHistoryFile(file); // waliduje nazwe pliku
  const todo = store.filter((it) => !(it.rating?.requirements === requirements && it.rating?.score != null));
  const total = todo.length;
  let done = 0;
  for (let i = 0; i < todo.length; i += concurrency) {
    await Promise.all(
      todo.slice(i, i + concurrency).map(async (it) => {
        try {
          const details = it.url ? await offerDetails(it.url) : null;
          const r = await rateOffer({ ...it, ...details }, requirements);
          it.rating = { score: r.score, reason: r.reason, requirements, at: Date.now() };
        } catch (e) {
          it.rating = { error: String(e.message || e), requirements, at: Date.now() };
        }
        onRated?.({ key: key(it), rating: it.rating, done: ++done, total });
      })
    );
    await setJson(file, store);
  }
  return store;
}

// Zapis oceny do oferty w jej store (szukamy po id/url we wszystkich store'ach).
export async function saveRating(offer, rating, requirements) {
  const k = key(offer);
  if (!k) return;
  for (const f of await listFiles()) {
    const store = await getJson(f, []);
    const it = store.find((n) => key(n) === k);
    if (it) {
      it.rating = { score: rating.score, reason: rating.reason, requirements, at: Date.now() };
      await setJson(f, store);
      return;
    }
  }
}

export async function scrape(portal, url) {
  if (!(portal in BASE)) throw new Error(`Nieznany portal: ${portal}`);
  if (!url) throw new Error("Brak URL.");
  const fresh = portal === "olx" || portal === "otodom"
    ? await scrapeNext(url, BASE[portal])
    : await scrapeGeneric(url, BASE[portal]);

  const name = storeName(portal, url);
  const store = await getJson(name, []);
  const have = new Map(store.map((s) => [key(s), s]));
  for (const n of fresh) {
    const ex = have.get(key(n));
    if (ex) ex.photo ??= n.photo; // stare wpisy sprzed zdjec dostaja fotke przy ponownym scrape
    else { have.set(key(n), n); store.push(n); }
  }
  await setJson(name, store);
  const manifest = await getJson(MANIFEST, {});
  manifest[name] = { url, portal, count: store.length, title: store[0]?.title || name, at: Date.now() };
  await setJson(MANIFEST, manifest);
  return store;
}

// Uruchomienie z CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , portal, url] = process.argv;
  if (!portal || !url) {
    console.error(`Uzycie: node scraper.js <${PORTALS.join("|")}> <url>`);
    process.exit(1);
  }
  scrape(portal, url)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error("Blad:", e.message);
      process.exit(1);
    });
}
