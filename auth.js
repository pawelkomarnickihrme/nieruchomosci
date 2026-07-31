import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { allowSignIn } from "./allowlist.js";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    signIn: allowSignIn,
    authorized: ({ auth }) => !!auth?.user, // uzywane przez proxy.js: brak sesji -> redirect na strone logowania
  },
});
