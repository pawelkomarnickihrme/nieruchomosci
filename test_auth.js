import assert from "node:assert";

process.env.AUTH_ALLOWED_EMAILS = "Roman@Gmail.com, ktos@example.com";
const { allowSignIn } = await import("./allowlist.js");

assert(allowSignIn({ profile: { email: "roman@gmail.com", email_verified: true } }), "dozwolony (inna wielkosc liter)");
assert(!allowSignIn({ profile: { email: "obcy@gmail.com", email_verified: true } }), "spoza listy");
assert(!allowSignIn({ profile: { email: "roman@gmail.com", email_verified: false } }), "niezweryfikowany mail");
assert(!allowSignIn({}), "brak profilu");
console.log("ok");
