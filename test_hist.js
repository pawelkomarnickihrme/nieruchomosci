import assert from "node:assert";
import { rmSync } from "node:fs";
import { loadHistoryFile, listHistory, historyOf, pushHistory } from "./scraper.js";

// Path-traversal guard: tylko czyste nazwy .json (funkcje sa async — guard leci jako odrzucenie).
await assert.rejects(() => loadHistoryFile("../.env"));
await assert.rejects(() => loadHistoryFile("/etc/passwd"));
await assert.rejects(() => loadHistoryFile("x.txt"));
assert.deepEqual(await loadHistoryFile("nie-ma-takiego.json"), []);
assert(Array.isArray(await listHistory()));

// Historia tozsamosci: najnowsze na gorze, bez duplikatu tego samego pliku, bez wycieku miedzy kontami.
const who = "user-test@example.com";
const guest = "guest-11111111-2222-3333-4444-555555555555";
const e = (file, count) => ({ file, portal: "olx", url: "", count, title: file, at: Date.now() });
await pushHistory(who, e("a.json", 1));
await pushHistory(who, e("b.json", 2));
const rows = await pushHistory(who, e("a.json", 3));
assert.deepEqual(rows.map((r) => r.file), ["a.json", "b.json"]);
assert.equal(rows[0].count, 3);
assert.equal((await historyOf(who)).length, 2);
assert.deepEqual(await historyOf("user-kto-inny@example.com"), []);

// Gosc dostaje wlasny kubelek, nie widzi historii konta.
await pushHistory(guest, e("c.json", 7));
assert.deepEqual((await historyOf(guest)).map((r) => r.file), ["c.json"]);
assert.equal((await historyOf(who)).length, 2);

rmSync("data/hist-user-test-example-com.json", { force: true });
rmSync(`data/hist-${guest}.json`, { force: true });

console.log("ok");
