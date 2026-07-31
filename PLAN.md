# Plan rozwoju

Ustalenia z sesji 2026-07-31. Plik jest źródłem prawdy o kierunku — decyzje razem
z powodami, żeby za miesiąc nie zgadywać, dlaczego coś wygląda tak, a nie inaczej.

## Czym to jest

Łowca ogłoszeń dla **całego OLX** (19 kategorii główych), nie tylko nieruchomości —
nazwa repo i nagłówek strony mylą. Produkt dla wielu użytkowników, docelowo płatny.

Dwa tryby:

- **Znajdź** — darmowy hook. Opisujesz czego szukasz, AI przekopuje wiszące oferty.
  To jest to, co działa dziś.
- **Poluj** — subskrypcja. Zapisane kryteria, cron, alerty mailem. Do zbudowania.

## Model danych, do którego zmierzamy

- **Store ofert** — globalny, jeden na wyszukiwanie, dzielony przez wszystkich.
  Czyste oferty plus historia cen. Bez ocen. Dzielenie oszczędza requesty do OLX
  i chroni przed banem — dwudziesta osoba szukająca Gdańska nie kosztuje nic.
- **Warstwa ocen** — osobno, kluczowana store'em i odciskiem tekstu wymagań.
  Niewidoczna dla użytkownika, działa jako cache przy identycznych wymaganiach.
- **Analiza** — obiekt należący do użytkownika: wybrane wyszukiwanie + jego
  wymagania + wskazanie na warstwę ocen. Własny nieodgadywalny adres. Link działa
  bez logowania, tylko do odczytu, z przyciskiem „przelicz po swojemu", który
  tworzy odbiorcy własną kopię.

Rozwiązuje trzy rzeczy naraz: nikt nie nadpisuje cudzych ocen, nikt nie widzi
cudzych kryteriów przypadkiem, identyczna praca nie jest liczona dwa razy.

---

# Fala 1 — fundament ✅ zrobiona

Kroki 1–4 wykonane. Odstępstwa od pierwotnego planu, świadome:

- `loadHistoryFile` → **`loadStore`**. Po wprowadzeniu analiz „historia" znaczy listę analiz
  użytkownika, więc stara nazwa myliła — funkcja ładuje oferty, nie historię.
- **`slug.js` usunięty.** Routing przeszedł na `/a/<id>`, więc `histSlug` został bez użytkownika.
- **`listHistory` i `saveRating` usunięte** — pierwsze porzucone przez nowy routing, drugie było
  martwe już wcześniej (nikt go nie wołał).
- **`whoami.js` wydzielone** z `/api/history` — potrzebują go teraz dwa endpointy.
- **`scrape()` zwraca `{ store, added, dropped }`** zamiast samej tablicy. Scalanie i tak musi
  porównać oferty, więc delta wychodzi za darmo — krok 7 dostaje ją gotową.
- Doszły **`listKeys`** oraz **`readData`/`writeData`** (niski poziom) — używa ich migracja,
  a w fali 2 cron potrzebuje przejść po wszystkich analizach.

Migracja lokalna wykonana: 999 ocen przeniesionych do warstwy, store zszedł z 1,7 MB do 404 KB.
**Migracja produkcji jeszcze nie uruchomiona** — czeka, bo musi pójść razem z wdrożeniem kodu
(stary kod czyta oceny z `it.rating`, którego migracja się pozbywa). Na produkcji czeka
1203 ocen w trzech store'ach. Skrypt `migrate.js` można skasować po przejściu obu środowisk.

## Krok 1 · Historia cen

**Pierwszy, bo zwłoka kosztuje bezpowrotnie** — obniżki widać dopiero od dnia wdrożenia.

`scraper.js`, `scrape()` (linie 274–279). Dziś przy trafieniu na istniejącą ofertę
rusza się wyłącznie `photo`, więc ceny są zamrożone z pierwszego pobrania.

Zmiana: porównaj cenę, przy zmianie dopisz wpis do `prices: [{ price, at }]`
i zaktualizuj `price`. Nowe oferty dostają pierwszy wpis od razu.

Sprawdzenie: `test_price.js` — dwa przebiegi z podmienioną ceną, asercja na długość
historii i cenę bieżącą.

Rozmiar: kilkanaście linii.

## Krok 2 · Oceny wychodzą ze store'u

Pliki: `scraper.js` (`rateAll`, `saveRating`), `app/api/rate-all/route.js`,
`app/api/load/route.js`

Dziś ocena mieszka w samej ofercie (`scraper.js:238`) w globalnym store. Skutek przy
dwóch użytkownikach: drugi widzi kryteria pierwszego w polu „Czego szukasz?"
(`page.jsx:83`), a klikając „Oceń wszystkie" przelicza wszystko od zera i nadpisuje
cudze oceny.

Powstaje osobny wpis `rate-<store>-<odcisk>` o kształcie:

```
{ requirements, at, byKey: { klucz: { score, reason } } }
```

Odcisk to 12 znaków skrótu z tekstu wymagań (`node:crypto`, zero nowych zależności).
`rateAll` czyta store i warstwę, liczy wyłącznie brakujące klucze, zapisuje warstwę
po każdym batchu. `saveRating` znika — przestaje mieć sens przeszukiwanie wszystkich
store'ów w poszukiwaniu jednej oferty.

Cache dzielony wypada z tego za darmo: ten sam odcisk to trafienie. Liczy się
najbardziej przy klonowaniu analiz, gdzie tekst wymagań jest kopiowany co do znaku.

**Migracja:** jednorazowy skrypt grupuje istniejące `it.rating` po treści wymagań
i przenosi do warstw. 1005 ocenionych ofert w Gdańsku przeżywa.

## Krok 3 · Analizy per user i udostępnianie

Pliki: `scraper.js`, `app/api/history/route.js`, nowy `app/api/analysis/route.js`,
`page.jsx`, `slug.js`

Analiza: `{ id, owner, file, requirements, title, at }` pod nieodgadywalnym
identyfikatorem. `hist-<userId>` trzyma listę identyfikatorów zamiast wpisów z nazwą
pliku.

- `GET /api/analysis?id=` — publiczne, **nie wywołuje `whoami()`**, żeby podgląd nie
  zakładał odbiorcy konta gościa
- `POST /api/analysis` — tworzy analizę właścicielowi
- `POST /api/analysis` z `clone=` — kopia pod nowym identyfikatorem, oryginał nietknięty

Adres przechodzi na `/a/<id>`. Powód: dzisiejszy slug powstaje wyłącznie z URL-a
wyszukiwania (`slug.js`), więc dwie osoby szukające Gdańska dostają identyczny adres —
przy analizach per user to kolizja. `slug.js` zostaje wyłącznie do etykiet w UI.

Do wyrzucenia: `/api/history?slug=` (`route.js:26`) przeszukuje globalną historię
i oddaje wpis bez sprawdzania, kto pyta — udostępnianie przez zgadnięcie adresu.

UI: przycisk „Udostępnij" oraz — przy cudzej analizie — baner tylko-do-odczytu
z przyciskiem „Przelicz po swojemu".

**Najcięższy krok całej fali.** Wymaga migracji istniejących wpisów `hist-*`.

## Krok 4 · Uczciwe urwanie

Pliki: `scraper.js`, `app/api/rate-all/route.js`, `page.jsx`

Gdańsk to 1185 ofert. `rateAll` przy `concurrency: 5` robi na ofertę fetch szczegółów
plus streaming z modelu — realnie 15–20 minut. Sufit `maxDuration` to 300 s na Hobby
i 800 s na Pro; 3000 s nie istnieje na żadnym planie. Funkcja umiera po ~25% ofert,
a użytkownik nie dostaje o tym słowa: strumień się urywa, pasek postępu znika.

`rateAll` dostaje nieprzekraczalny termin (~270 s przy limicie 300 s, margines na
zapis), przerywa pętlę i domyka strumień informacją o urwaniu. UI pokazuje
„Oceniono 312 z 1185 — kontynuuj". Wznawianie już działa — `rateAll` pomija ocenione.

Rozmiar: ~20 linii.

---

# Fala 2 — poluj

## Krok 5 · Limit ochronny

`@upstash/ratelimit` na Upstashu, który już jest w projekcie (skille leżą
w `.agents/skills/upstash-ratelimit-js`). Okno przesuwne rzędu 20 pobrań na godzinę
z adresu, na `/api/scrape` i na klonowanie analizy.

To nie jest cennik, tylko ochrona dostępu do OLX — bez niego jedna pętla albo ktoś,
kto odkryje otwarte `/api/scrape`, zdejmuje scraper na dobre.

## Krok 6 · Cron ⚠️ blokada planu

**Do zweryfikowania, zanim ten krok ruszy.** Projekt siedzi w personal scope
`obywatelezatorzagmailcoms-projects`, czyli plan Hobby. Na Hobby crony Vercela są
ograniczone do jednego uruchomienia dziennie, a `maxDuration` do twardych 300 s.
Monitoring raz na dobę to nie monitoring.

Trzy wyjścia:

1. **GitHub Actions co 15 minut** uderzające w `/api/hunt` — darmowe, omija limit
   Vercela, repo i tak jest na GitHubie. **Rekomendacja na start.**
2. Pro (~20 USD/mc) — cron z granularnością minutową i 800 s.
3. Pogodzenie się z częstotliwością dobową.

Powstaje `/api/hunt` chroniony sekretem, przechodzący po analizach z włączoną flagą
obserwowania, plus przełącznik w UI.

## Krok 7 · Trzy wyzwalacze

Wewnątrz `/api/hunt`, na danych z kroków 1 i 6:

- **nowa oferta** — klucze nieobecne w store; `scrape` już to wie, wystarczy żeby
  zwracał deltę zamiast całości
- **obniżka ceny** — dwa ostatnie wpisy w `prices`
- **poniżej rynku** — porównanie z medianą store'u, próg rzędu −35%

Mediana działa, bo store jest osobny na każde zapytanie: store „iPhone 13 128GB
Gdańsk" zawiera prawie wyłącznie iPhone'y 13, więc jego mediana **jest** ceną
rynkową tego modelu. Zero AI, zero bazy modeli. Skuteczność zależy od precyzji
zapytania — dla „Elektronika › Gdańsk" bezużyteczne, ale to problem użytkownika.

AI ocenia wyłącznie deltę, więc mieści się w każdym limicie czasu — ta sama ścieżka,
która omija ścianę 300 s.

## Krok 8 · E-mail

Dostawca przez `vercel integration` (Marketplace), bez wpisywania SDK na sztywno.
Adres pochodzi z logowania Google, więc użytkownik nie konfiguruje niczego.

Jeden zbiorczy list na analizę na przebieg: „7 nowych trafień, 2 obniżki, 1 poniżej
rynku" z odnośnikami. Próg oceny odsiewa szum.

---

# Poza planem — świadomie

- **Wstępny filtr tnący koszt modelu.** Pełne ocenianie wszystkich ofert bez
  wstępnego odsiewu; decyzja: płacimy. Rząd wielkości: ~1,8 mln tokenów wejściowych
  na jedno przeszukanie Gdańska. Gdyby wróciło jako problem — jeden tani call
  zamieniający wymagania w twarde kryteria zbija 1185 do ~80 przed dotknięciem AI.
- **Bramka płatności i limity planów.** Monetyzacja później.
- **Portale poza OLX.** `BASE` w `scraper.js` ma już otodom, allegro i komornika,
  UI ma tylko OLX (`page.jsx:51`).
- **Zmiana nazwy projektu.** Repo, tytuł i nagłówek mówią „nieruchomości" przy
  produkcie obejmującym 19 kategorii.

**Do zrobienia poza planem:** `AUTH_ALLOWED_EMAILS` przepuszcza dziś tylko wskazane
adresy — trzeba odblokować przed pierwszym zaproszonym użytkownikiem. Jedna zmienna
środowiskowa.

# Punkty, po których można się zatrzymać

- Po **kroku 1** — historia cen działa, dane przestają uciekać.
- Po **kroku 4** — aplikacja jest poprawnie wielodostępna, ma udostępnianie
  i nie kłamie o postępie. Moment, w którym da się ją komuś pokazać.
- Kroki **5–8** dokładają tryb „poluj".
