"use client";

import type { SnapshotsResponse } from "@/lib/types";

function fmt(v: number | null) {
  if (v === null) return <span className="text-gray-600">—</span>;
  const formatted = `$${Math.abs(v).toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
  return (
    <span className={v >= 0 ? "text-green-400" : "text-red-400"}>
      {v >= 0 ? "+" : "-"}{formatted}
    </span>
  );
}

function fmtUsd(v: number) {
  return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
}

interface Props {
  data: SnapshotsResponse | null;
}

export default function PnLTable({ data }: Props) {
  if (!data) return null;

  const { pnl } = data;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800">
      <div className="p-4 border-b border-gray-800">
        <h2 className="font-semibold text-white">PnL přehled</h2>
      </div>

      {/* Portfolio total row */}
      <div className="p-4 border-b border-gray-800 grid grid-cols-5 gap-2 text-sm">
        <div className="text-gray-400 font-medium col-span-1">Celkem</div>
        <div className="text-right">{fmt(pnl.total_1d)}</div>
        <div className="text-right">{fmt(pnl.total_7d)}</div>
        <div className="text-right">{fmt(pnl.total_30d)}</div>
        <div className="text-right">{fmt(pnl.total_all)}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs border-b border-gray-800">
              <th className="text-left px-4 py-2">Peněženka</th>
              <th className="text-left px-4 py-2">Chain</th>
              <th className="text-right px-4 py-2">Hodnota</th>
              <th className="text-right px-4 py-2">24h</th>
              <th className="text-right px-4 py-2">7d</th>
              <th className="text-right px-4 py-2">30d</th>
              <th className="text-right px-4 py-2">All-time</th>
            </tr>
          </thead>
          <tbody>
            {pnl.by_wallet.map((w) => (
              <tr
                key={w.wallet_id}
                className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium text-white">
                    {w.wallet_label ?? "Peněženka " + w.wallet_id}
                  </div>
                  <div className="text-xs text-gray-600 font-mono">
                    {w.wallet_address.slice(0, 8)}...{w.wallet_address.slice(-4)}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">
                  {w.chain}
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-white tabular-nums">
                  {fmtUsd(w.current_usd)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {fmt(w.pnl_1d)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {fmt(w.pnl_7d)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {fmt(w.pnl_30d)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {fmt(w.pnl_all)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
