import { historyOf } from "../../../scraper.js";
import { whoami } from "../../../whoami.js";

// Pasek boczny: kto jest zalogowany i jakie ma analizy. Sam odczyt nie zaklada konta goscia —
// ciasteczko pojawia sie dopiero przy pierwszej zapisanej analizie.
// Analizy powstaja przez /api/analysis; tutaj zostal juz tylko odczyt listy.
export async function GET() {
  const { id, user } = await whoami({ create: false });
  return Response.json({ user, rows: id ? await historyOf(id) : [] });
}
