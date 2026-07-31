import { cookies } from "next/headers";
import { auth } from "./auth.js";

// Tozsamosc: mail zalogowanego albo konto goscia — losowy id w ciasteczku. Dzieki temu anonim
// tez ma swoje analizy w bazie, tyle ze zwiazane z przegladarka.
// create:false przy samym odczycie — podglad udostepnionego linku nie ma powodu zakladac konta
// odbiorcy ani zostawiac mu ciasteczka.
export async function whoami({ create = true } = {}) {
  // Brak skonfigurowanego logowania (np. pusty AUTH_SECRET) nie moze kłasc calej aplikacji —
  // wtedy po prostu kazdy jest gosciem i korzysta bez konta.
  const email = await auth().then((s) => s?.user?.email).catch(() => null);
  if (email) return { id: `user-${email}`, user: email };
  const jar = await cookies();
  let guest = jar.get("guest")?.value;
  if (!guest) {
    if (!create) return { id: null, user: null };
    guest = crypto.randomUUID();
    jar.set("guest", guest, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return { id: `guest-${guest}`, user: null };
}
