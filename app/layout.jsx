import { Fraunces, Instrument_Sans } from "next/font/google";
import "./style.css";

// next/font: fonty self-hostowane z fallbackiem o tych samych metrykach — zero skoku layoutu przy ladowaniu.
const fraunces = Fraunces({ subsets: ["latin", "latin-ext"], axes: ["opsz"], variable: "--font-fraunces" });
const sans = Instrument_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-sans" });

export const metadata = { title: "Nieruchomości — łowca ogłoszeń" };

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: wtyczki (np. LanguageTool) dopisuja atrybuty do <html> przed hydracja
    <html lang="pl" className={`${fraunces.variable} ${sans.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
