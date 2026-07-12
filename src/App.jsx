import { useState, useMemo, useEffect } from "react";

const PORTALS = [
  { id: "olx", label: "OLX", ex: "https://www.olx.pl/nieruchomosci/mieszkania/wynajem/gdansk/" },
  { id: "otodom", label: "Otodom", ex: "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/mazowieckie/warszawa/warszawa/warszawa" },
  { id: "allegro", label: "Allegro Lokalnie", ex: "https://allegrolokalnie.pl/oferty/nieruchomosci" },
  { id: "komornik", label: "Licytacje komornicze", ex: "https://licytacje.komornik.pl/Notice/Search" },
];
const money = (v) => (v == null ? "—" : new Intl.NumberFormat("pl-PL").format(v) + " zł");

// Ladny hash w URL: portal + sciezka wyszukiwania zamiast nazwy pliku (#olx-mieszkania-wynajem-gdansk).
function slug(h) {
  try {
    return [h.portal, ...new URL(h.url).pathname.split("/").filter((s) => s && s !== "pl" && s !== "nieruchomosci")]
      .join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  } catch {
    return h.file.replace(/\.json$/i, "");
  }
}

// Czyta NDJSON z fetch-a i wola onLine dla kazdej sparsowanej linii.
async function readNdjson(res, onLine) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
}

export default function App() {
  const [portal, setPortal] = useState("olx");
  const [url, setUrl] = useState(PORTALS[0].ex);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [req, setReq] = useState("");
  const [ratings, setRatings] = useState({});
  const [history, setHistory] = useState([]);
  const [active, setActive] = useState("");
  const [rateAllLoading, setRateAllLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }

  const loadHistory = () =>
    fetch("/api/history").then((r) => r.json()).then((h) => { setHistory(h); return h; }).catch(() => []);

  // Pokaz oferty + odtworz zapisane oceny i wymagania, wedlug ktorych powstaly (najnowsze).
  function showItems(arr) {
    setItems(arr);
    const seed = {};
    let last = null;
    for (const it of arr) if (it.rating) {
      seed[it.id || it.url] = it.rating;
      if (it.rating.requirements && (!last || (it.rating.at || 0) > (last.at || 0))) last = it.rating;
    }
    setRatings(seed);
    if (last) setReq(last.requirements);
  }

  // Czysty start: pusty formularz, zadny wpis z historii nie jest aktywny.
  function newSearch() {
    setActive("");
    setItems([]);
    setRatings({});
    setReq("");
    setErr("");
    setPortal("olx");
    setUrl(PORTALS[0].ex);
    window.history.pushState(null, "", "/");
  }

  async function openHist(h) {
    setPortal(h.portal);
    if (h.url) setUrl(h.url);
    setActive(h.file);
    window.history.pushState(null, "", "/" + slug(h)); // kazde zapytanie ma swoj URL
    setErr("");
    try {
      const r = await fetch(`/api/load?file=${encodeURIComponent(h.file)}`);
      showItems(await r.json());
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  async function rateAll() {
    if (!active) return;
    setRateAllLoading(true);
    setProgress({ done: 0, total: 0 });
    setErr("");
    try {
      const res = await fetch("/api/rate-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: active, requirements: req }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Błąd");
      // NDJSON: parsuj linie na biezaco i wyrzucaj oceny na strone.
      await readNdjson(res, (m) => {
        if (m.error) throw new Error(m.error);
        setRatings((r) => ({ ...r, [m.key]: m.rating }));
        setProgress({ done: m.done, total: m.total });
      });
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setRateAllLoading(false);
      setProgress(null);
    }
  }

  // Na starcie: wczytaj historie i otworz zapytanie z URL-a (#hash), a bez niego najnowsze.
  useEffect(() => {
    fetch("/api/history").then((r) => r.json()).then((h) => {
      setHistory(h);
      const want = decodeURIComponent(location.hash.slice(1) || location.pathname.slice(1));
      // Dopasuj po slugu; stare linki z # lub nazwa pliku tez dzialaja.
      const hit = h.find((x) => slug(x) === want || x.file === want) || h[0];
      if (hit) openHist(hit);
    }).catch(() => {});
  }, []);

  async function rate(it) {
    const key = it.id || it.url;
    setRatings((r) => ({ ...r, [key]: { loading: true } }));
    try {
      const res = await fetch("/api/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offer: it, requirements: req }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Błąd");
      // NDJSON: {partial} w trakcie generowania (ocena "pisze sie" na zywo), ostatnia linia = final.
      let final = null;
      await readNdjson(res, (m) => {
        if (m.error) throw new Error(m.error);
        if (m.partial) setRatings((r) => ({ ...r, [key]: { ...m.partial, loading: true } }));
        else { final = m; setRatings((r) => ({ ...r, [key]: m })); }
      });
      if (!final) throw new Error("Brak wyniku.");
    } catch (e) {
      setRatings((r) => ({ ...r, [key]: { error: String(e.message || e) } }));
    }
  }

  function pickPortal(id) {
    setPortal(id);
    setUrl(PORTALS.find((p) => p.id === id).ex);
  }

  async function run(e) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/scrape?portal=${portal}&url=${encodeURIComponent(url)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Błąd serwera");
      showItems(d);
      const h = await loadHistory();
      if (h[0]) { setActive(h[0].file); window.history.pushState(null, "", "/" + slug(h[0])); } // najnowszy wpis = wlasnie zescrapowany

    } catch (e) {
      setErr(String(e.message || e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  // Zawsze od najlepszej oceny; nieocenione na koncu w kolejnosci scrape'a.
  const view = useMemo(() => {
    const score = (it) => ratings[it.id || it.url]?.score ?? -1;
    return [...items].sort((x, y) => score(y) - score(x));
  }, [items, ratings]);

  return (
    <div className="layout">
      <aside>
        <button type="button" className="hist new" onClick={newSearch} disabled={!active && items.length === 0}>
          + Nowe wyszukiwanie
        </button>
        <h2>Historia</h2>
        {history.length === 0 && <div className="muted small">Brak wyszukan.</div>}
        {history.map((h) => (
          <button
            type="button"
            key={h.file}
            className={"hist" + (h.file === active ? " on" : "")}
            onClick={() => openHist(h)}
          >
            <span className="tag">{h.portal}</span>
            <span className="ht" title={h.url || h.title}>{h.url || h.title}</span>
            <span className="muted small">{h.count}</span>
          </button>
        ))}
      </aside>
      <main>
      <header>
        <p className="kicker">Łowca ogłoszeń</p>
        <h1>
          Nieruchomości <span className="muted">· {items.length} ofert</span>
        </h1>
        <form className="hunt" onSubmit={run}>
          <select value={portal} onChange={(e) => pickPortal(e.target.value)}>
            {PORTALS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <input className="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Wklej URL kategorii z portalu" />
          <button type="submit" className="primary" disabled={loading}>{loading ? "Scrapuję…" : "Scrapuj"}</button>
        </form>
        {items.length > 0 && (
          <div className="brief">
            <label htmlFor="req">Czego szukasz?</label>
            <textarea
              id="req"
              rows={3}
              value={req}
              onChange={(e) => setReq(e.target.value)}
              placeholder={"Opisz wymagania, np.:\ndo 3000 zł, 2 pokoje, blisko centrum, balkon, zwierzęta mile widziane"}
            />
            <div className="brief-foot">
              <span className="muted small">AI oceni każdą ofertę 1–10 względem wymagań — lista sama ułoży się od najlepszych.</span>
              <button type="button" className="primary" onClick={rateAll} disabled={!req.trim() || !active || rateAllLoading}>
                {rateAllLoading ? "Oceniam wszystkie…" : `Oceń wszystkie (${items.length})`}
              </button>
            </div>
          </div>
        )}
        {progress && (
          <div className="progress">
            <div className="track">
              <div className="bar" style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : "0%" }} />
            </div>
            <span className="small muted">{progress.done}/{progress.total}</span>
          </div>
        )}
      </header>

      {err && <div className="empty error">{err}</div>}
      {!err && view.length === 0 && <div className="empty">{loading ? "Ładowanie…" : "Wybierz portal, wklej URL kategorii i kliknij Scrapuj."}</div>}

      <div className="grid">
        {view.map((it, i) => (
          <div className="card" key={it.id || it.url || i}>
            <div className="price">{money(it.price)}</div>
            <a href={it.url} target="_blank" rel="noopener">{it.title || "(bez tytułu)"}</a>
            {it.location && <div className="loc">{it.location}</div>}
            {(() => {
              const r = ratings[it.id || it.url];
              return (
                <>
                  <button type="button" onClick={() => rate(it)} disabled={!req.trim() || r?.loading}>
                    {r?.loading ? "Oceniam…" : "Oceń"}
                  </button>
                  {r?.score != null && (
                    <div className="score">
                      <span className="score-num">{r.score}<small>/10</small></span>
                      <span>{r.reason}</span>
                    </div>
                  )}
                  {r?.error && <div className="score error">{r.error}</div>}
                </>
              );
            })()}
          </div>
        ))}
      </div>
      </main>
    </div>
  );
}
