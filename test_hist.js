import assert from "node:assert";
import { loadHistoryFile, listHistory } from "./scraper.js";

// Path-traversal guard: tylko czyste nazwy .json.
assert.throws(() => loadHistoryFile("../.env"));
assert.throws(() => loadHistoryFile("/etc/passwd"));
assert.throws(() => loadHistoryFile("x.txt"));
assert.deepEqual(loadHistoryFile("nie-ma-takiego.json"), []);
assert(Array.isArray(listHistory()));
console.log("ok");
