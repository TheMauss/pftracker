"use client";

import { useState } from "react";
import type { RawDefiPosition } from "@/lib/types";

const PROTOCOL_COLORS: Record<string, string> = {
  kamino: "bg-orange-900/50 text-orange-300",
  drift: "bg-blue-900/50 text-blue-300",
  marginfi: "bg-violet-900/50 text-violet-300",
  orca: "bg-cyan-900/50 text-cyan-300",
  raydium: "bg-indigo-900/50 text-indigo-300",
  meteora: "bg-teal-900/50 text-teal-300",
  jlp: "bg-green-900/50 text-green-300",
  aave: "bg-purple-900/50 text-purple-300",
  hyperlend: "bg-emerald-900/50 text-emerald-300",
  felix: "bg-yellow-900/50 text-yellow-300",
  pendle: "bg-pink-900/50 text-pink-300",
  uniswap: "bg-rose-900/50 text-rose-300",
  gmx: "bg-blue-900/50 text-blue-200",
};

const TYPE_LABEL: Record<string, string> = {
  lend: "Lend",
  borrow: "Borrow",
  lp: "LP",
  vault: "Vault",
  stake: "Stake",
  perp: "Perp",
  pt: "PT",
  yt: "YT",
  cdp: "CDP",
};

function fmt(v: number) {
  return `$${Math.abs(v).toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
}

interface Props {
  positions: RawDefiPosition[];
  walletLabel?: string;
}

export default function DeFiPositions({ positions, walletLabel }: Props) {
  const [filter, setFilter] = useState<"all" | "lend" | "borrow" | "lp">("all");

  const filtered = positions.filter((p) => {
    if (filter === "all") return true;
    if (filter === "lend") return !p.is_debt && p.position_type !== "lp";
    if (filter === "borrow") return p.is_debt;
    if (filter === "lp")
      return (
        p.position_type === "lp" ||
        p.position_type === "vault" ||
        p.position_type === "pt" ||
        p.position_type === "yt"
      );
    return true;
  });

  const totalLend = positions
    .filter((p) => !p.is_debt)
    .reduce((s, p) => s + p.value_usd, 0);
  const totalBorrow = positions
    .filter((p) => p.is_debt)
    .reduce((s, p) => s + p.value_usd, 0);
  const netUsd = totalLend - totalBorrow;

  if (positions.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-4 px-5">
        Žádné DeFi pozice
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-white">
            DeFi pozice {walletLabel ? `— ${walletLabel}` : ""}
          </h3>
          <div className="text-xs text-gray-500 mt-0.5">
            Deposito: {fmt(totalLend)} · Dluh: {fmt(totalBorrow)} · Net:{" "}
            <span className={netUsd >= 0 ? "text-green-400" : "text-red-400"}>
              {fmt(netUsd)}
            </span>
          </div>
        </div>
        <div className="flex gap-1 text-xs">
          {(["all", "lend", "borrow", "lp"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded transition-colors ${
                filter === f
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:bg-gray-800"
              }`}
            >
              {f === "all" ? "Vše" : f === "lend" ? "Lend" : f === "borrow" ? "Borrow" : "LP/Vault"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs border-b border-gray-800">
              <th className="text-left px-4 py-2">Protokol</th>
              <th className="text-left px-4 py-2">Typ</th>
              <th className="text-left px-4 py-2">Asset</th>
              <th className="text-right px-4 py-2">Hodnota</th>
              <th className="text-right px-4 py-2">APY</th>
              <th className="text-left px-4 py-2">Chain</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((pos, i) => (
              <tr
                key={i}
                className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
              >
                <td className="px-4 py-2.5">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      PROTOCOL_COLORS[pos.protocol] ?? "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {pos.protocol.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`text-xs font-medium ${
                      pos.is_debt ? "text-red-400" : "text-green-400"
                    }`}
                  >
                    {TYPE_LABEL[pos.position_type] ?? pos.position_type}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-200 font-medium">
                  {pos.asset_symbol}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                    pos.is_debt ? "text-red-300" : "text-white"
                  }`}
                >
                  {pos.is_debt ? "-" : ""}
                  {fmt(pos.value_usd)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {pos.apy !== null && pos.apy !== undefined ? (
                    <span
                      className={pos.is_debt ? "text-red-400" : "text-green-400"}
                    >
                      {pos.is_debt ? "" : "+"}
                      {pos.apy.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">
                  {pos.chain}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
