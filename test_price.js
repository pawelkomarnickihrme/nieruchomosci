import assert from "node:assert";
import { mergeFresh, ratingsKey } from "./scraper.js";

// --- Historia cen ----------------------------------------------------------
// Nowa oferta zaklada historie od razu.
const store = [];
let r = mergeFresh(store, [{ id: "1", title: "a", price: 100 }], 1000);
assert.deepEqual(r.added, ["1"]);
assert.deepEqual(store[0].prices, [{ price: 100, at: 1000 }]);

// Ta sama cena przy ponownym scrape = brak nowego wpisu.
r = mergeFresh(store, [{ id: "1", title: "a", price: 100 }], 2000);
assert.equal(store[0].prices.length, 1, "niezmieniona cena nie dopisuje wpisu");
assert.deepEqual(r.added, []);
assert.deepEqual(r.dropped, []);

// Obnizka: wpis w historii, aktualizacja ceny biezacej i sygnal dla monitoringu.
r = mergeFresh(store, [{ id: "1", title: "a", price: 80 }], 3000);
assert.deepEqual(r.dropped, ["1"]);
assert.equal(store[0].price, 80);
assert.deepEqual(store[0].prices, [{ price: 100, at: 1000 }, { price: 80, at: 3000 }]);

// Podwyzka tez laduje w historii, ale obnizka nie jest.
r = mergeFresh(store, [{ id: "1", title: "a", price: 90 }], 4000);
assert.deepEqual(r.dropped, []);
assert.equal(store[0].prices.length, 3);
assert.equal(store[0].price, 90);

// Wpis sprzed wprowadzenia historii cen dostaje ja przy pierwszej zmianie (at: 0 = data nieznana).
const old = [{ id: "9", title: "x", price: 50 }];
mergeFresh(old, [{ id: "9", title: "x", price: 40 }], 5000);
assert.deepEqual(old[0].prices, [{ price: 50, at: 0 }, { price: 40, at: 5000 }]);

// Oferta bez ceny nie wywraca scalania.
const noPrice = [];
mergeFresh(noPrice, [{ id: "7", title: "y" }], 6000);
assert.deepEqual(noPrice[0].prices, []);
mergeFresh(noPrice, [{ id: "7", title: "y", price: 10 }], 7000);
assert.deepEqual(noPrice[0].prices, [{ price: 10, at: 7000 }]);

// Wpis bez id i bez url jest nie do zaadresowania — pomijamy zamiast psuc store.
const skip = [];
assert.deepEqual(mergeFresh(skip, [{ title: "bez klucza", price: 1 }], 8000).added, []);
assert.equal(skip.length, 0);

// --- Odcisk wymagan --------------------------------------------------------
// Ten sam tekst = ten sam klucz (to na tym stoi cache miedzy analizami).
assert.equal(ratingsKey("a.json", "  2 pokoje "), ratingsKey("a.json", "2 pokoje"));
assert.notEqual(ratingsKey("a.json", "2 pokoje"), ratingsKey("a.json", "3 pokoje"));
assert.notEqual(ratingsKey("a.json", "x"), ratingsKey("b.json", "x"));
assert.match(ratingsKey("a.json", "x"), /^rate-a-[0-9a-f]{12}\.json$/);

console.log("ok");
