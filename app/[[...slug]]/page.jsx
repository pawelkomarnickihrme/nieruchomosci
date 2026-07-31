"use client";

import { useState, useMemo, useEffect } from "react";
import CATS from "../olx-categories.json"; // drzewo kategorii OLX (nazwa, segment sciezki, dzieci)
import { histSlug as slug } from "../../slug.js";

const money = (v) => (v == null ? "—" : new Intl.NumberFormat("pl-PL").format(v) + " zł");

// "Zielona Góra" -> "zielona-gora", "Łódź" -> "lodz" (NFD nie rozklada ł).
const citySlug = (s) =>
  s.trim().toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Domyslnie: Nieruchomosci > Mieszkania > Wynajem.
const DEF_CAT = Math.max(0, CATS.findIndex((c) => c.p === "nieruchomosci"));
const DEF_SUB = Math.max(-1, (CATS[DEF_CAT].c || []).findIndex((c) => c.p === "mieszkania"));
const DEF_SUB2 = Math.max(-1, (CATS[DEF_CAT].c?.[DEF_SUB]?.c || []).findIndex((c) => c.p === "wynajem"));

// Czytelna etykieta wyszukiwania: "Mieszkania › Wynajem › Gdansk" zamiast surowego URL-a.
function label(u) {
  try {
    return new URL(u).pathname.split("/").filter((s) => s && s !== "pl")
      .map((p) => p.split("-").map((w) => (w[0] || "").toUpperCase() + w.slice(1)).join(" "))
      .join(" › ");
  } catch { return u || ""; }
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
  const [url, setUrl] = useState(""); // URL aktywnego wyszukiwania (z historii lub zbudowany)
  // Budowanie linku z kategorii + miasta zamiast wklejania.
  const [cat, setCat] = useState(DEF_CAT);
  const [sub, setSub] = useState(DEF_SUB);   // -1 = cala kategoria
  const [sub2, setSub2] = useState(DEF_SUB2);
  const [city, setCity] = useState("");
  const subs = CATS[cat].c || [];
  const subs2 = subs[sub]?.c || [];
  const builtUrl = useMemo(() => {
    const parts = [CATS[cat].p, subs[sub]?.p, subs2[sub2]?.p, citySlug(city)].filter(Boolean);
    return "https://www.olx.pl/" + parts.join("/") + "/";
  }, [cat, sub, sub2, city]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [req, setReq] = useState("");
  const [ratings, setRatings] = useState({});
  const [history, setHistory] = useState([]); // historia konta — dociagana w efekcie, SSR jej nie ma
  const [user, setUser] = useState(null);     // mail zalogowanego albo null; anonim korzysta bez historii
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
    setUrl("");
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

  // Na starcie: kto jest zalogowany + jego historia, potem otworz zapytanie z adresu.
  // Link spoza historii (albo od anonima) rozwiazuje /api/history?slug= — dane sa w bazie, ale nie ladują do paska.
  useEffect(() => {
    (async () => {
      const me = await fetch("/api/history").then((r) => r.json()).catch(() => ({ user: null, rows: [] }));
      setUser(me.user);
      setHistory(me.rows);
      const want = decodeURIComponent(location.hash.slice(1) || location.pathname.slice(1));
      if (!want) return;
      const hit = me.rows.find((x) => slug(x) === want || x.file === want)
        || (await fetch(`/api/history?slug=${encodeURIComponent(want)}`).then((r) => r.json()).catch(() => null));
      if (hit) openHist(hit);
    })();
  }, []);

  async function run(e) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/scrape?portal=${portal}&url=${encodeURIComponent(builtUrl)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Błąd serwera");
      setUrl(builtUrl);
      showItems(d.items);
      const entry = { file: d.file, portal, url: builtUrl, count: d.items.length, title: d.items[0]?.title || d.file, at: Date.now() };
      cache.set(entry.file, d.items);
      setActive(entry.file);
      window.history.pushState(null, "", "/" + slug(entry));
      // Historia idzie do bazy zawsze — zalogowanym pod mail, gosciom pod id z ciasteczka.
      const rows = await fetch("/api/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry),
      }).then((r) => r.json());
      if (Array.isArray(rows)) setHistory(rows);
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
            <span className="ht" title={h.url || h.title}>{h.url ? label(h.url) : h.title}</span>
            <span className="muted small">{h.count}</span>
          </button>
        ))}
        {/* Gosc ma historie zwiazana z przegladarka; logowanie przypina ja do konta. */}
        {user
          ? <a className="muted small acct" href="/api/auth/signout">{user} · wyloguj</a>
          : <a className="muted small acct" href="/api/auth/signin">Gość · zaloguj się przez Google</a>}
      </aside>}
      <main>
      <header>
        <p className="kicker">Łowca ogłoszeń</p>
        {!active ? (
          /* Home: tylko formularz nowej analizy. */
          <>
            <h1>Szukaj ofert</h1>
            <p className="muted small">Wybierz kategorię i miasto — resztą zajmiemy się my.</p>
            <form className="hunt" onSubmit={run}>
              <select value={cat} onChange={(e) => { setCat(+e.target.value); setSub(-1); setSub2(-1); }}>
                {CATS.map((c, i) => <option key={c.p} value={i}>{c.n}</option>)}
              </select>
              {subs.length > 0 && (
                <select value={sub} onChange={(e) => { setSub(+e.target.value); setSub2(-1); }}>
                  <option value={-1}>Wszystkie</option>
                  {subs.map((c, i) => <option key={c.p} value={i}>{c.n}</option>)}
                </select>
              )}
              {subs2.length > 0 && (
                <select value={sub2} onChange={(e) => setSub2(+e.target.value)}>
                  <option value={-1}>Wszystkie</option>
                  {subs2.map((c, i) => <option key={c.p} value={i}>{c.n}</option>)}
                </select>
              )}
              <input className="url" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Miasto (puste = cała Polska)" />
              <button type="submit" className="primary" disabled={loading}>{loading ? "Pobieram oferty…" : "Pobierz oferty"}</button>
            </form>
            <p className="muted small"><a href={builtUrl} target="_blank" rel="noopener">Podejrzyj to wyszukiwanie na OLX ↗</a></p>
          </>
        ) : (
          /* Widok wyszukiwania: opis (zrodlo + prompt) i lista ocen. */
          <>
            <button type="button" className="hist new" onClick={newSearch}>← Nowe wyszukiwanie</button>
            <h1>
              {url ? label(url) : "Oferty"} <span className="muted">· {items.length} ofert</span>
            </h1>
            {url && <p className="muted small"><a href={url} target="_blank" rel="noopener">Zobacz na OLX ↗</a></p>}
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
      {!err && view.length === 0 && <div className="empty">{loading ? "Pobieram oferty…" : "Wybierz kategorię i miasto, potem kliknij „Pobierz oferty”."}</div>}

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
