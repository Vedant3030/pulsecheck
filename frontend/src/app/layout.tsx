import Link from "next/link";
import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PulseCheck",
  description: "Uptime monitoring — ICU-style status wall",
};

// Dark is the default. Light applies only when the user explicitly chose it.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("pulsecheck-theme");
    if (stored === "light") {
      document.documentElement.classList.add("light");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-grid bg-bg-panel px-5 py-4 text-center text-xs text-[var(--text-muted)]">
          <span>PulseCheck — uptime monitoring</span>
          <span className="mx-2">·</span>
          <Link href="/privacy" className="underline-offset-4 hover:text-[var(--text-main)] hover:underline">Privacy</Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="underline-offset-4 hover:text-[var(--text-main)] hover:underline">Terms</Link>
        </footer>
      </body>
    </html>
  );
}
