import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Portfolio Tracker",
  description: "Crypto portfolio tracker with DeFi positions and AI analysis",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs">
      <body className="bg-gray-950 text-gray-100 min-h-screen antialiased">
        <nav className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
            <span className="text-white font-bold text-lg tracking-tight">
              📊 Portfolio
            </span>
            <div className="flex gap-1">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/defi">DeFi</NavLink>
              <NavLink href="/history">Historie</NavLink>
              <NavLink href="/wallets">Peněženky</NavLink>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
    >
      {children}
    </Link>
  );
}
