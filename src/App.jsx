import { useState, useMemo, useEffect } from "react";

const PORTALS = [
  { id: "olx", label: "OLX", ex: "https://www.olx.pl/nieruchomosci/mieszkania/wynajem/gdansk/" },
  { id: "otodom", label: "Otodom", ex: "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/mazowieckie/warszawa/warszawa/warszawa" },
  { id: "allegro", label: "Allegro Lokalnie", ex: "https://allegrolokalnie.pl/oferty/nieruchomosci" },
  { id: "komornik", label: "Licytacje komornicze", ex: "https://licytacje.komornik.pl/Notice/Search" },
];
const money = (v) => (v == null ? "—" : new Intl.NumberFormat("pl-PL").format(v) + " zł");

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
  const [q, setQ] = useState("");
  const [max, setMax] = useState("");
  const [sort, setSort] = useState("none");
  const [req, setReq] = useState("");
  const [ratings, setRatings] = useState({});
  const [history, setHistory] = useState([]);
  const [active, setActive] = useState("");
  const [rateAllLoading, setRateAllLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }

  const loadHistory = () =>
    fetch("/api/history").then((r) => r.json()).then((h) => { setHistory(h); return h; }).catch(() => []);

  // Pokaz oferty + odtworz zapisane oceny.
  function showItems(arr) {
    setItems(arr);
    const seed = {};
    for (const it of arr) if (it.rating) seed[it.id || it.url] = it.rating;
    setRatings(seed);
  }

  async function openHist(h) {
    setPortal(h.portal);
    if (h.url) setUrl(h.url);
    setActive(h.file);
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

  // Na starcie: wczytaj historie i pokaz najnowsze wyszukanie.
  useEffect(() => {
    fetch("/api/history").then((r) => r.json()).then((h) => {
      setHistory(h);
      if (h[0]) openHist(h[0]);
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
      if (h[0]) setActive(h[0].file); // najnowszy wpis = wlasnie zescrapowany

    } catch (e) {
      setErr(String(e.message || e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  const view = useMemo(() => {
    let a = items.filter(
      (it) =>
        (!q || (it.title || "").toLowerCase().includes(q.toLowerCase())) &&
        (!max || (it.price != null && it.price <= Number(max)))
    );
    if (sort === "asc") a = [...a].sort((x, y) => (x.price ?? 1e18) - (y.price ?? 1e18));
    if (sort === "desc") a = [...a].sort((x, y) => (y.price ?? -1) - (x.price ?? -1));
    const score = (it) => ratings[it.id || it.url]?.score ?? -1;
    if (sort === "score") a = [...a].sort((x, y) => score(y) - score(x));
    return a;
  }, [items, q, max, sort, ratings]);

  return (
    <div className="layout">
      <aside>
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
        <h1>
          Ogłoszenia <span className="muted">— {view.length}/{items.length}</span>
        </h1>
        <form className="controls" onSubmit={run}>
          <select value={portal} onChange={(e) => pickPortal(e.target.value)}>
            {PORTALS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <input className="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL kategorii" />
          <button type="submit" disabled={loading}>{loading ? "Scrapuję…" : "Scrapuj"}</button>
        </form>
        {items.length > 0 && (
          <div className="controls">
            <input type="search" placeholder="Szukaj w tytule…" value={q} onChange={(e) => setQ(e.target.value)} />
            <input type="number" placeholder="Cena max" value={max} onChange={(e) => setMax(e.target.value)} />
            <button type="button" onClick={() => setSort((s) => (s === "asc" ? "desc" : s === "desc" ? "none" : "asc"))}>
              Cena {sort === "asc" ? "↑" : sort === "desc" ? "↓" : "—"}
            </button>
            <button type="button" onClick={() => setSort((s) => (s === "score" ? "none" : "score"))}>
              Ocena {sort === "score" ? "↓" : "—"}
            </button>
            <input className="url" value={req} onChange={(e) => setReq(e.target.value)} placeholder="Wymagania do oceny (np. do 3000 zł, blisko centrum, 2 pokoje)" />
            <button type="button" onClick={rateAll} disabled={!req || !active || rateAllLoading}>
              {rateAllLoading ? "Oceniam wszystkie…" : `Oceń wszystkie (${items.length})`}
            </button>
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
                  <button type="button" onClick={() => rate(it)} disabled={!req || r?.loading}>
                    {r?.loading ? "Oceniam…" : "Oceń"}
                  </button>
                  {r?.score != null && <div className="score">Ocena: {r.score}/10 — {r.reason}</div>}
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
