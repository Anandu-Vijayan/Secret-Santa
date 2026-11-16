import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./portal.css";

// Self-hosted (OFL licensed) so builds never depend on reaching Google Fonts.
const display = localFont({
  src: "./fonts/Gloock-Regular.woff2",
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const sans = localFont({
  src: "./fonts/FamiljenGrotesk-Variable.woff2",
  weight: "400 700",
  variable: "--font-text",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Secret Santa",
  description: "Draw names for your gift exchange and let everyone privately see who they're buying for.",
};

export const viewport: Viewport = {
  themeColor: "#8E1B2C",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
