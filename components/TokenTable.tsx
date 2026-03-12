"use client";

import { useState } from "react";
import type { RawTokenBalance } from "@/lib/types";
import { usePrivacy, mask } from "@/lib/privacy";

const CHAIN_BADGE: Record<string, string> = {
  solana:      "badge badge-solana",
  ethereum:    "badge badge-ethereum",
  base:        "badge badge-base",
  arbitrum:    "badge badge-arbitrum",
  bsc:         "badge badge-bsc",
  hyperliquid: "badge badge-hyperliquid",
  hyperevm:    "badge badge-hyperevm",
  sui:         "badge badge-sui",
};

function fmtValue(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
  return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })}`;
}

function fmtAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
  if (n >= 1)         return n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
  if (n >= 0.0001)    return n.toLocaleString("cs-CZ", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return n.toExponential(2);
}

function fmtPrice(v: number) {
  if (v >= 1_000) return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
  if (v >= 1)     return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })}`;
  if (v >= 0.01)  return `$${v.toLocaleString("cs-CZ", { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`;
  return `$${v.toLocaleString("cs-CZ", { minimumFractionDigits: 6, maximumFractionDigits: 8 })}`;
}

interface Props {
  tokens:   RawTokenBalance[];
  totalUsd: number;
  title?:   string;
}

export default function TokenTable({ tokens, totalUsd, title = "Tokeny" }: Props) {
  const [search, setSearch] = useState("");
  const { hidden } = usePrivacy();

  const filtered = tokens
    .filter((t) => !t.is_derivative)
    .filter((t) =>
      t.token_symbol.toLowerCase().includes(search.toLowerCase()) ||
      (t.token_name ?? "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => b.value_usd - a.value_usd);

  return (
    <div className="card rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>{title}</h2>
          {filtered.length > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums"
              style={{ background: "rgba(255,255,255,0.06)", color: "#505050" }}
            >
              {filtered.length}
            </span>
          )}
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Hledat…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field text-xs rounded-lg pl-3 pr-3 py-1.5 w-36"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {["Token", "Počet", "Hodnota", "%", "Chain", "Cena"].map((h, i) => (
                <th
                  key={h}
                  className={`px-5 py-2.5 stat-label ${i === 1 || i === 2 || i === 3 || i === 5 ? "text-right" : "text-left"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-16 text-xs" style={{ color: "#505050" }}>
                  {search ? "Žádné výsledky" : "Žádné tokeny"}
                </td>
              </tr>
            )}
            {filtered.map((t, i) => {
              const pct = totalUsd > 0 ? (t.value_usd / totalUsd) * 100 : 0;
              return (
                <tr
                  key={i}
                  className="group transition-colors duration-100"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  {/* Token */}
                  <td className="px-5 py-3">
                    <div className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>
                      {t.token_symbol}
                    </div>
                    {t.token_name && t.token_name !== t.token_symbol && (
                      <div className="text-[10px] mt-0.5 truncate max-w-[120px]" style={{ color: "#404040" }}>
                        {t.token_name}
                      </div>
                    )}
                  </td>

                  {/* Počet */}
                  <td className="px-5 py-3 text-right">
                    <span className="text-xs tabular-nums" style={{ color: "#606060" }}>
                      {mask(fmtAmount(t.amount), hidden)}
                    </span>
                  </td>

                  {/* Hodnota */}
                  <td className="px-5 py-3 text-right">
                    <div className="text-sm font-semibold tabular-nums" style={{ color: "#f0f0f0" }}>
                      {t.value_usd > 0 ? mask(fmtValue(t.value_usd), hidden) : <span style={{ color: "#303030" }}>?</span>}
                    </div>
                  </td>

                  {/* % + bar */}
                  <td className="px-5 py-3 text-right">
                    <div className="text-xs tabular-nums mb-1" style={{ color: "#505050" }}>
                      {pct >= 0.1 ? pct.toFixed(1) : "<0.1"}%
                    </div>
                    <div
                      className="h-[2px] rounded-full ml-auto overflow-hidden"
                      style={{ width: 48, background: "rgba(255,255,255,0.05)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(pct * 2, 100)}%`,
                          background: "linear-gradient(90deg, #3cffa0, #2dd4bf)",
                        }}
                      />
                    </div>
                  </td>

                  {/* Chain */}
                  <td className="px-5 py-3">
                    <span className={CHAIN_BADGE[t.chain] ?? "badge badge-default"}>
                      {t.chain}
                    </span>
                  </td>

                  {/* Cena */}
                  <td className="px-5 py-3 text-right">
                    <span className="text-xs tabular-nums" style={{ color: "#505050" }}>
                      {t.price_usd != null && t.price_usd > 0
                        ? fmtPrice(t.price_usd)
                        : <span style={{ color: "#252525" }}>—</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
