"use client";

import { useState } from "react";
import type { RawTokenBalance } from "@/lib/types";

const CHAIN_COLORS: Record<string, string> = {
  solana: "bg-purple-900/60 text-purple-300",
  ethereum: "bg-blue-900/60 text-blue-300",
  base: "bg-blue-900/60 text-blue-200",
  arbitrum: "bg-sky-900/60 text-sky-300",
  bsc: "bg-yellow-900/60 text-yellow-300",
  hyperliquid: "bg-green-900/60 text-green-300",
  hyperevm: "bg-emerald-900/60 text-emerald-300",
};

function fmt(v: number) {
  if (v >= 1000) return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
  return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })}`;
}

function fmtAmount(v: number) {
  if (v >= 1000) return v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString("cs-CZ", { maximumFractionDigits: 4 });
  return v.toLocaleString("cs-CZ", { maximumFractionDigits: 6 });
}

interface Props {
  tokens: RawTokenBalance[];
  title?: string;
}

export default function TokenTable({ tokens, title = "Tokeny" }: Props) {
  const [search, setSearch] = useState("");

  const filtered = tokens
    .filter((t) => !t.is_derivative)
    .filter(
      (t) =>
        t.token_symbol.toLowerCase().includes(search.toLowerCase()) ||
        (t.token_name ?? "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => b.value_usd - a.value_usd);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800">
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h2 className="font-semibold text-white">{title}</h2>
        <input
          type="text"
          placeholder="Hledat token..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm bg-gray-800 rounded px-3 py-1.5 text-gray-300 placeholder-gray-600 border border-gray-700 focus:outline-none focus:border-indigo-500 w-40"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs border-b border-gray-800">
              <th className="text-left px-4 py-2">Token</th>
              <th className="text-left px-4 py-2">Chain</th>
              <th className="text-right px-4 py-2">Množství</th>
              <th className="text-right px-4 py-2">Cena</th>
              <th className="text-right px-4 py-2">Hodnota</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-500 py-8">
                  Žádné tokeny
                </td>
              </tr>
            )}
            {filtered.map((t, i) => (
              <tr
                key={i}
                className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium text-white">{t.token_symbol}</div>
                  {t.token_name && t.token_name !== t.token_symbol && (
                    <div className="text-xs text-gray-500">{t.token_name}</div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      CHAIN_COLORS[t.chain] ?? "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {t.chain}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">
                  {fmtAmount(t.amount)}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums">
                  {t.price_usd !== null && t.price_usd !== undefined
                    ? `$${t.price_usd.toLocaleString("en-US", { maximumFractionDigits: 4 })}`
                    : <span className="text-gray-600">—</span>}
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-white tabular-nums">
                  {t.value_usd > 0 ? fmt(t.value_usd) : (
                    <span className="text-gray-600">?</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
