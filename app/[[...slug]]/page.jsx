"use client";

import { useState, useMemo, useEffect } from "react";

const OLX_EX = "https://www.olx.pl/nieruchomosci/mieszkania/wynajem/gdansk/";
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

// Historia per uzytkownik w localStorage — baza trzyma dane, ale liste wyszukan kazdy ma swoja.
const LS = "nieruchomosci:hist";
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch { return []; } };
function saveLocal(entry) {
  const next = [entry, ...readLocal().filter((x) => x.file !== entry.file)];
  localStorage.setItem(LS, JSON.stringify(next));
  return next;
}

// Cache ofert w pamieci (plik -> items): powrot do wyszukiwania renderuje sie od razu z cache,
// a swieze dane dociagaja sie w tle — strona nie pustoszeje i nie skacze przy wczytywaniu.
const cache = new Map();

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
  const portal = "olx"; // ponytail: tylko OLX — wroc do selecta, gdy dojdzie drugi portal
  const [url, setUrl] = useState(OLX_EX);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [req, setReq] = useState("");
  const [ratings, setRatings] = useState({});
  const [history, setHistory] = useState([]); // localStorage dopiero w efekcie — SSR go nie ma
  const [active, setActive] = useState("");
  const [rateAllLoading, setRateAllLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }

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
    setUrl(OLX_EX);
    window.history.pushState(null, "", "/");
  }

  async function openHist(h) {
    if (h.url) setUrl(h.url);
    setActive(h.file);
    window.history.pushState(null, "", "/" + slug(h)); // kazde zapytanie ma swoj URL
    setErr("");
    const hit = cache.get(h.file);
    if (hit) showItems(hit); // od razu z cache, swieze dane podmienia sie po cichu
    try {
      const r = await fetch(`/api/load?file=${encodeURIComponent(h.file)}`);
      const fresh = await r.json();
      cache.set(h.file, fresh);
      showItems(fresh);
    } catch (e) {
      if (!hit) setErr(String(e.message || e));
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
      cache.delete(active); // oceny zmienily plik na serwerze — nastepne otwarcie dociagnie swieze
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setRateAllLoading(false);
      setProgress(null);
    }
  }

  // Na starcie: wczytaj lokalna historie i otworz zapytanie z URL-a. Udostepniony link
  // (spoza historii) rozwiazujemy przez /api/history — dane sa w bazie, ale nie laduje do paska.
  useEffect(() => {
    const local = readLocal();
    setHistory(local);
    const want = decodeURIComponent(location.hash.slice(1) || location.pathname.slice(1));
    if (!want) return;
    const find = (h) => h.find((x) => slug(x) === want || x.file === want);
    const hit = find(local);
    if (hit) openHist(hit);
    else fetch("/api/history").then((r) => r.json()).then((h) => { const s = find(h); if (s) openHist(s); }).catch(() => {});
  }, []);

  async function run(e) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/scrape?portal=${portal}&url=${encodeURIComponent(url)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Błąd serwera");
      showItems(d);
      // Wpis do lokalnej historii: serwer zna nazwe pliku, bierzemy ja z /api/history.
      const sh = await fetch("/api/history").then((r) => r.json());
      const mine = sh.find((x) => x.portal === portal && x.url === url);
      if (mine) {
        cache.set(mine.file, d);
        setHistory(saveLocal(mine));
        setActive(mine.file);
        window.history.pushState(null, "", "/" + slug(mine));
      }
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
      {!active && <aside>
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
      </aside>}
      <main>
      <header>
        <p className="kicker">Łowca ogłoszeń</p>
        {!active ? (
          /* Home: tylko formularz nowej analizy. */
          <>
            <h1>Nowa analiza</h1>
            <p className="muted small">
              Wejdź na <a href="https://www.olx.pl/nieruchomosci/" target="_blank" rel="noopener">OLX</a>,
              wybierz kategorię i miasto, a potem wklej tutaj link z paska adresu.
            </p>
            <form className="hunt" onSubmit={run}>
              <input className="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={OLX_EX} />
              <button type="submit" className="primary" disabled={loading}>{loading ? "Scrapuję…" : "Scrapuj"}</button>
            </form>
          </>
        ) : (
          /* Widok wyszukiwania: opis (zrodlo + prompt) i lista ocen. */
          <>
            <button type="button" className="hist new" onClick={newSearch}>← Nowe wyszukiwanie</button>
            <h1>
              Nieruchomości <span className="muted">· {items.length} ofert</span>
            </h1>
            {url && <p className="muted small">{url}</p>}
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
                  <button type="button" className="primary" onClick={rateAll} disabled={!req.trim() || rateAllLoading}>
                    {rateAllLoading ? "Oceniam wszystkie…" : `Oceń wszystkie (${items.length})`}
                  </button>
                </div>
              </div>
            )}
          </>
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
      {!err && view.length === 0 && <div className="empty">{loading ? "Ładowanie…" : "Wklej link z OLX i kliknij Scrapuj."}</div>}

      <div className="grid">
        {view.map((it, i) => (
          <div className="card" key={it.id || it.url || i}>
            {it.photo && (
              <a href={it.url} target="_blank" rel="noopener" className="thumb">
                <img src={it.photo.replace(/;s=\d+x\d+/, ";s=600x450")} alt="" loading="lazy" />
              </a>
            )}
            <div className="price">{money(it.price)}</div>
            <a href={it.url} target="_blank" rel="noopener">{it.title || "(bez tytułu)"}</a>
            {it.location && <div className="loc">{it.location}</div>}
            {(() => {
              const r = ratings[it.id || it.url];
              return (
                <>
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
