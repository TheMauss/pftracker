"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

export type CurrencyCode = "USD" | "CZK" | "EUR" | "GBP" | "PLN" | "HUF";

export const CURRENCIES: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: "USD", symbol: "$",  label: "USD" },
  { code: "CZK", symbol: "Kč", label: "CZK" },
  { code: "EUR", symbol: "€",  label: "EUR" },
  { code: "GBP", symbol: "£",  label: "GBP" },
  { code: "PLN", symbol: "zł", label: "PLN" },
  { code: "HUF", symbol: "Ft", label: "HUF" },
];

interface CurrencyCtx {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  rates: Record<string, number>;
  /** Convert a USD value to the selected currency */
  convert: (usd: number) => number;
  /** Format a USD value in the selected currency */
  fxFmt: (usd: number) => string;
}

const Ctx = createContext<CurrencyCtx>({
  currency: "USD",
  setCurrency: () => {},
  rates: {},
  convert: (v) => v,
  fxFmt: (v) => `$${v.toFixed(0)}`,
});

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<CurrencyCode>("USD");
  const [rates, setRates] = useState<Record<string, number>>({});

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vault_currency") as CurrencyCode | null;
      if (saved && CURRENCIES.some((c) => c.code === saved)) setCurrencyState(saved);
    } catch {}
  }, []);

  // Fetch exchange rates
  useEffect(() => {
    fetch("/api/rates")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.rates) setRates(d.rates); })
      .catch(() => {});
  }, []);

  const setCurrency = useCallback((c: CurrencyCode) => {
    setCurrencyState(c);
    try { localStorage.setItem("vault_currency", c); } catch {}
  }, []);

  const convert = useCallback((usd: number): number => {
    if (currency === "USD") return usd;
    const rate = rates[currency];
    return rate ? usd * rate : usd;
  }, [currency, rates]);

  const fxFmt = useCallback((usd: number): string => {
    const cur = CURRENCIES.find((c) => c.code === currency)!;
    const val = convert(usd);
    if (currency === "USD") return "";
    const abs = Math.abs(val);
    let formatted: string;
    if (currency === "HUF") {
      formatted = abs >= 1_000_000
        ? `${(abs / 1_000_000).toFixed(1)}M`
        : abs >= 1_000
        ? `${(abs / 1_000).toFixed(0)}K`
        : abs.toFixed(0);
    } else {
      formatted = abs >= 1_000_000
        ? `${(abs / 1_000_000).toFixed(2)}M`
        : abs >= 1_000
        ? `${(abs / 1_000).toFixed(1)}K`
        : abs.toFixed(0);
    }
    const sign = val < 0 ? "−" : "";
    return cur.code === "CZK" || cur.code === "HUF" || cur.code === "PLN"
      ? `${sign}${formatted} ${cur.symbol}`
      : `${sign}${cur.symbol}${formatted}`;
  }, [currency, convert]);

  return (
    <Ctx.Provider value={{ currency, setCurrency, rates, convert, fxFmt }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCurrency() {
  return useContext(Ctx);
}

/** Renders the fx-converted value as a small secondary line. Returns null if currency = USD. */
export function FxAmount({ usd, className, pnl }: { usd: number; className?: string; pnl?: boolean }) {
  const { currency, fxFmt } = useCurrency();
  if (currency === "USD") return null;
  const text = fxFmt(usd);
  if (!text) return null;
  const display = pnl && usd > 0 ? `+${text}` : text;
  return (
    <div
      className={className ?? "text-[10px] tabular-nums mt-0.5"}
      style={{ color: "#555555" }}
    >
      {display}
    </div>
  );
}
