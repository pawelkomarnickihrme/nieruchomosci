// Jednorazowa migracja do modelu z analizami. Odpal raz na kazdym srodowisku:
//   node migrate.js            — pokazuje, co by zrobil, nic nie zapisuje
//   node migrate.js --zapisz   — wykonuje
// Lokalnie dziala na data/, na Vercelu (KV_REST_API_URL) na Upstashu.
// Po przejsciu obu srodowisk plik mozna skasowac.
//
// Robi dwie rzeczy:
//  1. Wyprowadza oceny z ofert do warstw kluczowanych (store + odcisk wymagan). Bez tego
//     dotychczasowa praca modelu przepada, a store zostaje z cudzymi kryteriami w srodku.
//  2. Przerabia stare wpisy historii (bez id) na analizy. Bez tego pasek boczny pokazuje
//     wpisy, ktorych nie da sie otworzyc.

import { listKeys, readData, writeData, ratingsKey, createAnalysis } from "./scraper.js";

const WRITE = process.argv.includes("--zapisz");
const say = (...a) => console.log(...a);

async function migrateRatings() {
  const stores = (await listKeys("olx-")).concat(await listKeys("otodom-"));
  for (const file of stores) {
    const items = await readData(file, []);
    if (!Array.isArray(items) || !items.length) continue;
    // Grupujemy po tresci wymagan — kazda grupa to jedna warstwa ocen.
    const layers = new Map();
    let moved = 0;
    for (const it of items) {
      const r = it.rating;
      if (!r?.requirements || r.score == null) continue;
      const k = r.requirements;
      if (!layers.has(k)) layers.set(k, { requirements: k, at: r.at || Date.now(), byKey: {} });
      layers.get(k).byKey[it.id || it.url] = { score: r.score, reason: r.reason };
      moved++;
    }
    if (!moved) continue;
    for (const [reqs, layer] of layers) {
      const key = ratingsKey(file, reqs);
      say(`  ${file}: ${Object.keys(layer.byKey).length} ocen -> ${key}`);
      if (WRITE) {
        // Nie nadpisuj warstwy, ktora juz istnieje — migracja ma byc bezpieczna przy powtorce.
        const have = await readData(key, null);
        if (!have) await writeData(key, layer);
      }
    }
    if (WRITE) {
      for (const it of items) delete it.rating;
      await writeData(file, items);
    }
    say(`  ${file}: ${moved} ocen przeniesionych, rating usuniety z ofert`);
  }
}

async function migrateHistory() {
  for (const hist of await listKeys("hist-")) {
    const rows = await readData(hist, []);
    if (!Array.isArray(rows) || !rows.length) continue;
    const stale = rows.filter((r) => !r.id && r.file);
    if (!stale.length) { say(`  ${hist}: juz zmigrowane`); continue; }
    // Wlascicielem jest tozsamosc zaszyta w nazwie pliku historii. Nie da sie z niej
    // odtworzyc oryginalnego maila (nazwa jest znormalizowana), wiec zapisujemy ja
    // taka, jaka jest — dla goscia to i tak dokladnie ten sam klucz.
    const owner = hist.replace(/^hist-/, "").replace(/\.json$/, "");
    say(`  ${hist}: ${stale.length} wpisow -> analizy (wlasciciel: ${owner})`);
    if (!WRITE) continue;
    await writeData(hist, []); // createAnalysis odbuduje liste od zera
    for (const r of [...stale].reverse()) {
      // Wymagania odtwarzamy z ocen, ktore lezaly w store — to jest to, co uzytkownik
      // ostatnio widzial w polu "Czego szukasz?".
      const items = await readData(r.file, []);
      const last = items.map((i) => i.rating).filter((x) => x?.requirements)
        .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      await createAnalysis({ owner, file: r.file, requirements: last?.requirements || "", portal: r.portal || "", url: r.url || "", count: r.count || 0, title: r.title || r.file });
    }
  }
}

say(WRITE ? "MIGRACJA — zapisuje" : "PROBA — nic nie zapisuje (dodaj --zapisz)");
// Historia idzie pierwsza: odtwarza wymagania z it.rating, ktore migracja ocen zaraz usunie.
say("Historia:");
await migrateHistory();
say("Oceny:");
await migrateRatings();
say("gotowe");
