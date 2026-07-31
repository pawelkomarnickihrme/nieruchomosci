"use client";

import { useState, useMemo, useEffect } from "react";
import CATS from "../olx-categories.json"; // drzewo kategorii OLX (nazwa, segment sciezki, dzieci)

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

// Cache ofert w pamieci (plik -> items): powrot do analizy renderuje sie od razu z cache,
// a swieze dane dociagaja sie w tle — strona nie pustoszeje i nie skacze przy wczytywaniu.
// Store ofert jest wspolny dla wszystkich, wiec cache miedzy analizami tego samego
// wyszukiwania jest poprawny.
const cache = new Map();

// Adres analizy: /a/<id>. Id jest losowe, wiec link dziala jak udostepnienie.
const idFromPath = () => (location.pathname.match(/^\/a\/([a-z0-9]+)/i) || [])[1] || "";

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

  const [an, setAn] = useState(null);   // otwarta analiza: { id, file, url, requirements, ... }
  const [mine, setMine] = useState(false); // cudza analiza jest tylko do odczytu
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [req, setReq] = useState("");
  const [ratings, setRatings] = useState({});
  const [history, setHistory] = useState([]); // analizy uzytkownika — dociagane w efekcie
  const [user, setUser] = useState(null);     // mail zalogowanego albo null
  const [rateAllLoading, setRateAllLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [trunc, setTrunc] = useState(null);       // { done, total, left } po scieciu przez limit czasu
  const [copied, setCopied] = useState(false);

  const refreshHistory = () =>
    fetch("/api/history").then((r) => r.json()).then((me) => { setUser(me.user); setHistory(me.rows || []); }).catch(() => {});

  // Czysty start: pusty formularz, zadna analiza nie jest otwarta.
  function newSearch() {
    setAn(null); setMine(false); setItems([]); setRatings({}); setReq(""); setErr(""); setTrunc(null);
    window.history.pushState(null, "", "/");
  }

  async function openAnalysis(id, { push = true } = {}) {
    setErr(""); setTrunc(null); setCopied(false);
    if (push) window.history.pushState(null, "", "/a/" + id);
    const d = await fetch(`/api/analysis?id=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null);
    if (!d || d.error) { setErr(d?.error || "Nie udało się wczytać analizy."); return; }
    setAn(d.analysis);
    setMine(d.mine);
    setRatings(d.ratings || {});
    setReq(d.analysis.requirements || "");
    const hit = cache.get(d.analysis.file);
    if (hit) setItems(hit); // od razu z cache, swieze dane podmienia sie po cichu
    try {
      const fresh = await fetch(`/api/load?file=${encodeURIComponent(d.analysis.file)}`).then((r) => r.json());
      if (Array.isArray(fresh)) { cache.set(d.analysis.file, fresh); setItems(fresh); }
    } catch (e) {
      if (!hit) setErr(String(e.message || e));
    }
  }

  // Kopia cudzej analizy na wlasnosc klikajacego — oryginal zostaje nietkniety.
  async function clone() {
    if (!an) return;
    const d = await fetch(`/api/analysis?clone=${encodeURIComponent(an.id)}`, { method: "POST" }).then((r) => r.json());
    if (d?.id) { await refreshHistory(); openAnalysis(d.id); } else setErr(d?.error || "Nie udało się skopiować.");
  }

  async function share() {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function rate() {
    if (!an || !mine || !req.trim()) return;
    setRateAllLoading(true);
    setProgress({ done: 0, total: 0 });
    setErr(""); setTrunc(null);
    try {
      // Zmiana wymagan = inna warstwa ocen, wiec zapisujemy je w analizie i czyscimy ekran.
      if (req !== an.requirements) {
        await fetch(`/api/analysis?id=${encodeURIComponent(an.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requirements: req }),
        });
        setAn((a) => ({ ...a, requirements: req }));
        setRatings({});
      }
      const res = await fetch("/api/rate-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: an.file, requirements: req }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Błąd");
      // NDJSON: parsuj linie na biezaco i wyrzucaj oceny na strone.
      await readNdjson(res, (m) => {
        if (m.error) throw new Error(m.error);
        if (m.finished) { if (m.truncated) setTrunc(m); return; }
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

  // Na starcie: kto jest zalogowany + jego analizy, potem otworz analize z adresu.
  // Link do cudzej analizy dziala tak samo — /api/analysis jest publiczne.
  useEffect(() => {
    refreshHistory();
    const id = idFromPath();
    if (id) openAnalysis(id, { push: false });
  }, []);

  async function run(e) {
    e.preventDefault();
    setLoading(true);
    setErr(""); setTrunc(null);
    try {
      const r = await fetch(`/api/scrape?portal=${portal}&url=${encodeURIComponent(builtUrl)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Błąd serwera");
      const a = await fetch("/api/analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file: d.file, portal, url: builtUrl,
          count: d.items.length, title: d.items[0]?.title || d.file,
        }),
      }).then((r) => r.json());
      if (a?.error) throw new Error(a.error);
      cache.set(d.file, d.items);
      setItems(d.items);
      setRatings({});
      setReq("");
      setAn(a);
      setMine(true);
      window.history.pushState(null, "", "/a/" + a.id);
      refreshHistory();
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
      {!an && <aside>
        <button type="button" className="hist new" onClick={newSearch} disabled={items.length === 0}>
          + Nowe wyszukiwanie
        </button>
        <h2>Moje analizy</h2>
        {history.length === 0 && <div className="muted small">Brak analiz.</div>}
        {history.map((h) => (
          <button type="button" key={h.id} className="hist" onClick={() => openAnalysis(h.id)}>
            <span className="tag">{h.portal}</span>
            <span className="ht" title={h.url || h.title}>{h.url ? label(h.url) : h.title}</span>
            <span className="muted small">{h.count}</span>
          </button>
        ))}
        {/* Gosc ma analizy zwiazane z przegladarka; logowanie przypina je do konta. */}
        {user
          ? <a className="muted small acct" href="/api/auth/signout">{user} · wyloguj</a>
          : <a className="muted small acct" href="/api/auth/signin">Gość · zaloguj się przez Google</a>}
      </aside>}
      <main>
      <header>
        <p className="kicker">Łowca ogłoszeń</p>
        {!an ? (
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
          /* Widok analizy: zrodlo, wymagania i lista ocen. */
          <>
            <button type="button" className="hist new" onClick={newSearch}>← Nowe wyszukiwanie</button>
            <h1>
              {an.url ? label(an.url) : "Oferty"} <span className="muted">· {items.length} ofert</span>
            </h1>
            <p className="muted small">
              {an.url && <><a href={an.url} target="_blank" rel="noopener">Zobacz na OLX ↗</a> · </>}
              <button type="button" className="linkish" onClick={share}>{copied ? "Skopiowano link ✓" : "Udostępnij"}</button>
            </p>
            {!mine && (
              <div className="brief note">
                <span className="muted small">To analiza kogoś innego — widzisz ją tylko do odczytu.</span>
                <button type="button" className="primary" onClick={clone}>Przelicz po swojemu</button>
              </div>
            )}
            {mine && items.length > 0 && (
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
                  <button type="button" className="primary" onClick={rate} disabled={!req.trim() || rateAllLoading}>
                    {rateAllLoading ? "Oceniam…" : `Oceń wszystkie (${items.length})`}
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
        {/* Limit czasu funkcji sciol ocenianie — mow o tym wprost zamiast gasnac bez slowa. */}
        {trunc && (
          <div className="brief note">
            <span className="small">
              Oceniono {trunc.done} z {trunc.total} — zabrakło czasu na resztę ({trunc.left}).
              Oceny są zapisane, kolejne uruchomienie ruszy od miejsca przerwania.
            </span>
            <button type="button" className="primary" onClick={rate} disabled={rateAllLoading}>Kontynuuj</button>
          </div>
        )}
      </header>

      {err && <div className="empty error">{err}</div>}
      {!err && view.length === 0 && <div className="empty">{loading ? "Pobieram oferty…" : "Wybierz kategorię i miasto, potem kliknij „Pobierz oferty”."}</div>}

      <div className="grid">
        {view.map((it, i) => {
          const r = ratings[it.id || it.url];
          return (
            <div className="card" key={it.id || it.url || i}>
              {it.photo && (
                <a href={it.url} target="_blank" rel="noopener" className="thumb">
                  <img src={it.photo.replace(/;s=\d+x\d+/, ";s=600x450")} alt="" loading="lazy" />
                </a>
              )}
              <div className="price">
                {money(it.price)}
                {/* Historia cen: pokaz poprzednia cene, gdy oferta stanicala od pierwszego pobrania. */}
                {it.prices?.length > 1 && it.prices.at(-2).price > it.price && (
                  <span className="was">{money(it.prices.at(-2).price)}</span>
                )}
              </div>
              <a href={it.url} target="_blank" rel="noopener">{it.title || "(bez tytułu)"}</a>
              {it.location && <div className="loc">{it.location}</div>}
              {r?.score != null && (
                <div className="score">
                  <span className="score-num">{r.score}<small>/10</small></span>
                  <span>{r.reason}</span>
                </div>
              )}
              {r?.error && <div className="score error">{r.error}</div>}
            </div>
          );
        })}
      </div>
      </main>
    </div>
  );
}
