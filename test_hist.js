import assert from "node:assert";
import { rmSync } from "node:fs";
import { loadStore, historyOf, createAnalysis, getAnalysis, cloneAnalysis, updateAnalysis } from "./scraper.js";

// Path-traversal guard: tylko czyste nazwy .json (funkcje sa async — guard leci jako odrzucenie).
await assert.rejects(() => loadStore("../.env"));
await assert.rejects(() => loadStore("/etc/passwd"));
await assert.rejects(() => loadStore("x.txt"));
assert.deepEqual(await loadStore("nie-ma-takiego.json"), []);

const me = "user-test@example.com";
const other = "guest-11111111-2222-3333-4444-555555555555";
const trash = [];
const keep = (an) => (trash.push(`data/an-${an.id}.json`), an);

// Analiza: losowe id — adres /a/<id> jest jednoczesnie linkiem do udostepnienia.
const a = keep(await createAnalysis({ owner: me, file: "a.json", requirements: "2 pokoje", title: "A" }));
assert.match(a.id, /^[a-z0-9]{12}$/);
assert.equal((await getAnalysis(a.id)).owner, me);

// Zla nazwa pliku nie przechodzi przez tworzenie analizy.
await assert.rejects(() => createAnalysis({ owner: me, file: "../.env" }));

// Historia per tozsamosc: najnowsze na gorze, bez wycieku miedzy kontami.
const b = keep(await createAnalysis({ owner: me, file: "b.json", title: "B" }));
assert.deepEqual((await historyOf(me)).map((r) => r.id), [b.id, a.id]);
assert.deepEqual(await historyOf(other), []);

// Zapis wymagan przez wlasciciela nie duplikuje wpisu w historii, tylko podnosi go na gore.
await updateAnalysis(a.id, me, { requirements: "3 pokoje" });
assert.equal((await historyOf(me)).length, 2);
assert.deepEqual((await historyOf(me)).map((r) => r.id), [a.id, b.id]);
assert.equal((await getAnalysis(a.id)).requirements, "3 pokoje");

// Cudza analiza jest tylko do odczytu.
await assert.rejects(() => updateAnalysis(a.id, other, { requirements: "hop" }));
assert.equal((await getAnalysis(a.id)).requirements, "3 pokoje");

// Klon: nowy wlasciciel i nowe id, te same wymagania (czyli trafienie w gotowa warstwe ocen),
// oryginal nietkniety.
const c = keep(await cloneAnalysis(a.id, other));
assert.notEqual(c.id, a.id);
assert.equal(c.owner, other);
assert.equal(c.requirements, "3 pokoje");
assert.equal(c.file, a.file);
assert.equal((await getAnalysis(a.id)).owner, me);
assert.deepEqual((await historyOf(other)).map((r) => r.id), [c.id]);
assert.equal((await historyOf(me)).length, 2, "klon nie dopisuje sie do historii oryginalu");

// Nieistniejace i podejrzane id oddaja null zamiast rzucac.
assert.equal(await getAnalysis("../../etc/passwd"), null);
assert.equal(await getAnalysis("zle-id"), null);
assert.equal(await getAnalysis(""), null);
assert.equal(await getAnalysis("abcdef0123456789"), null);
await assert.rejects(() => cloneAnalysis("abcdef0123456789", me));

for (const f of trash) rmSync(f, { force: true });
rmSync("data/hist-user-test-example-com.json", { force: true });
rmSync(`data/hist-${other}.json`, { force: true });

console.log("ok");
