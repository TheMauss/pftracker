import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import Sidebar from "./NavBar";
import { PrivacyProvider } from "@/lib/privacy";
import { CurrencyProvider } from "@/lib/currency";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vault — Portfolio Tracker",
  description: "Crypto portfolio tracker with DeFi positions and AI analysis",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs" className={spaceGrotesk.variable}>
      <body className="bg-[#080808] text-[#f0f0f0] min-h-screen antialiased font-[family-name:var(--font-sans)]">
        {/* Ambient orbs — subtle depth */}
        <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
          <div
            className="absolute -top-60 -left-40 w-[800px] h-[800px] rounded-full blur-[160px]"
            style={{ background: "rgba(60,255,160,0.03)" }}
          />
          <div
            className="absolute top-1/3 -right-60 w-[600px] h-[600px] rounded-full blur-[140px]"
            style={{ background: "rgba(255,112,64,0.025)" }}
          />
        </div>

        <PrivacyProvider>
        <CurrencyProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 min-w-0 pl-[220px]">
              <div className="max-w-[1060px] mx-auto px-8 py-8">
                {children}
              </div>
            </main>
          </div>
        </CurrencyProvider>
        </PrivacyProvider>
      </body>
    </html>
  );
}
