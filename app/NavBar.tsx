"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivacy } from "@/lib/privacy";
import { useCurrency, CURRENCIES } from "@/lib/currency";

/* ── Icons ─────────────────────────────────────────────────────────────────── */
function IcGrid() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1.2" />
      <rect x="8.5" y="1" width="5.5" height="5.5" rx="1.2" />
      <rect x="1" y="8.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.2" />
    </svg>
  );
}

function IcLayers() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 1L13.5 4L7.5 7L1.5 4L7.5 1Z" />
      <path d="M1.5 8L7.5 11L13.5 8" />
      <path d="M1.5 11.5L7.5 14.5L13.5 11.5" />
    </svg>
  );
}

function IcTrendUp() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 10.5L5.5 6L8.5 9L14 3.5" />
      <path d="M10.5 3.5H14V7" />
    </svg>
  );
}


function IcWallet() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3.5" width="13" height="9" rx="1.8" />
      <path d="M1 6.5H14" />
      <circle cx="11.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IcArb() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5H10M10 5L7.5 2.5M10 5L7.5 7.5" />
      <path d="M13 10H5M5 10L7.5 7.5M5 10L7.5 12.5" />
    </svg>
  );
}

function IcStocks() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 11L4.5 7L7.5 9.5L11 5L14 3" />
      <path d="M1 14H14" />
    </svg>
  );
}

/* ── Nav links ─────────────────────────────────────────────────────────────── */
const LINKS = [
  { href: "/",           label: "Dashboard",  Icon: IcGrid },
  { href: "/defi",       label: "DeFi",       Icon: IcLayers },
  { href: "/yield",      label: "Yield",      Icon: IcTrendUp },
  { href: "/arbitrage",  label: "Arbitrage",  Icon: IcArb },
  { href: "/stocks",     label: "Akcie",      Icon: IcStocks },
  { href: "/wallets",    label: "Peněženky",  Icon: IcWallet },
];

/* ── Sidebar ────────────────────────────────────────────────────────────────── */
function IcEye({ crossed }: { crossed: boolean }) {
  return crossed ? (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1L14 14M6.2 6.3C5.8 6.7 5.5 7.1 5.5 7.5c0 1.1.9 2 2 2 .4 0 .8-.1 1.1-.3M3.5 3.7C2.2 4.7 1.2 6 1 7.5c.7 3.1 3.4 5 6.5 5 1.3 0 2.5-.4 3.5-1.1M11.8 9.8C12.9 8.8 13.8 7.3 14 5.5 13.3 2.4 10.6.5 7.5.5c-1.1 0-2.1.3-3 .8" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 7.5C1.7 4.4 4.4 2.5 7.5 2.5S13.3 4.4 14 7.5C13.3 10.6 10.6 12.5 7.5 12.5S1.7 10.6 1 7.5Z" />
      <circle cx="7.5" cy="7.5" r="2" />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { hidden, toggle } = usePrivacy();
  const { currency, setCurrency } = useCurrency();

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-[220px] flex flex-col z-50"
      style={{
        background: "rgba(8,8,8,0.96)",
        borderRight: "1px solid rgba(255,255,255,0.055)",
      }}
    >
      {/* Logo */}
      <div className="px-5 pt-6 pb-2">
        <Link href="/" className="flex items-center gap-2.5 group">
          {/* Diamond logo mark */}
          <div
            className="relative w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(60,255,160,0.18) 0%, rgba(60,255,160,0.06) 100%)",
              border: "1px solid rgba(60,255,160,0.25)",
              boxShadow: "0 0 16px rgba(60,255,160,0.12)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L13 7L7 13L1 7L7 1Z" fill="#3cffa0" fillOpacity="0.9" />
              <path d="M7 1L13 7L7 13L1 7L7 1Z" stroke="rgba(60,255,160,0.5)" strokeWidth="0.5" />
            </svg>
          </div>
          <div>
            <div className="text-[15px] font-black tracking-tight text-gradient leading-none">VAULT</div>
            <div className="text-[9px] font-semibold tracking-[0.12em] uppercase mt-0.5" style={{ color: "rgba(60,255,160,0.4)" }}>
              Portfolio
            </div>
          </div>
        </Link>
      </div>

      {/* Divider */}
      <div className="mx-5 my-4" style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />

      {/* Nav section label */}
      <div className="px-5 mb-1">
        <span className="text-[9px] font-bold tracking-[0.14em] uppercase" style={{ color: "rgba(255,255,255,0.2)" }}>
          Navigace
        </span>
      </div>

      {/* Nav links */}
      <nav className="px-3 flex-1 space-y-0.5">
        {LINKS.map(({ href, label, Icon }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group relative"
              style={{
                background: isActive ? "rgba(60,255,160,0.08)" : "transparent",
                color: isActive ? "#3cffa0" : "rgba(255,255,255,0.3)",
                border: isActive ? "1px solid rgba(60,255,160,0.15)" : "1px solid transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                  (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.6)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.3)";
                }
              }}
            >
              {/* Active glow indicator */}
              {isActive && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                  style={{ background: "#3cffa0", boxShadow: "0 0 8px rgba(60,255,160,0.8)" }}
                />
              )}
              <span className="shrink-0" style={{ color: isActive ? "#3cffa0" : "inherit" }}>
                <Icon />
              </span>
              <span className="tracking-[-0.01em]">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-5 pb-6 space-y-4">
        <div className="h-px" style={{ background: "rgba(255,255,255,0.05)" }} />

        {/* Currency picker */}
        <div>
          <div className="text-[9px] font-bold tracking-[0.12em] uppercase mb-1.5" style={{ color: "rgba(255,255,255,0.18)" }}>
            Měna
          </div>
          <div className="flex flex-wrap gap-1">
            {CURRENCIES.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => setCurrency(code)}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md transition-all duration-100"
                style={{
                  background: currency === code ? "rgba(60,255,160,0.12)" : "rgba(255,255,255,0.04)",
                  border: currency === code ? "1px solid rgba(60,255,160,0.25)" : "1px solid rgba(255,255,255,0.06)",
                  color: currency === code ? "#3cffa0" : "rgba(255,255,255,0.3)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Live status + privacy toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
                style={{ background: "#3cffa0" }}
              />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#3cffa0" }} />
            </span>
            <span className="text-xs font-medium" style={{ color: "rgba(60,255,160,0.6)" }}>Live</span>
          </div>
          <button
            onClick={toggle}
            title={hidden ? "Zobrazit hodnoty" : "Skrýt hodnoty"}
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150"
            style={{
              background: hidden ? "rgba(60,255,160,0.12)" : "rgba(255,255,255,0.04)",
              border: hidden ? "1px solid rgba(60,255,160,0.25)" : "1px solid rgba(255,255,255,0.07)",
              color: hidden ? "#3cffa0" : "rgba(255,255,255,0.25)",
            }}
          >
            <IcEye crossed={hidden} />
          </button>
        </div>
      </div>
    </aside>
  );
}
