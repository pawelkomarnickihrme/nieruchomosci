// Osobny plik, bo auth.js ciagnie next-auth i nie da sie go zaimportowac golym `node` w tescie.
const allowed = (process.env.AUTH_ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

// Pusta lista = wpuszczamy kazde zweryfikowane konto Google (tylko dev — na produkcji ustaw AUTH_ALLOWED_EMAILS).
export const allowSignIn = ({ profile } = {}) =>
  !!profile?.email_verified && (!allowed.length || allowed.includes(profile.email.toLowerCase()));
