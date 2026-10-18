import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Translator } from "./language";
// Plex Sans reads better than a monospace at 12-14px on a phone in a dark room.
// Plex Mono stays for allergen codes, prices and times, where alignment matters.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e0e0e" },
    { media: "(prefers-color-scheme: light)", color: "#f7f1e6" },
  ],
  colorScheme: "dark light",
};
// Applied before the first paint, so a light-theme phone never flashes dark on the way in.
const themeBoot = `try{var t=localStorage.getItem("heat-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}`;
// Same for Spanish: the page knows its language before it draws (see app/language.tsx).
const languageBoot = `try{if(localStorage.getItem("heat-lang")==="es")document.documentElement.lang="es";}catch(e){}`;
export const metadata: Metadata = {
  title: "HEAT · Know your menu",
  description: "Menu knowledge, ready for service.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // lang may already say "es" when React arrives: the boot script set it, on purpose.
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBoot + languageBoot }} /></head>
      <body>{children}<Translator /></body>
    </html>
  );
}
