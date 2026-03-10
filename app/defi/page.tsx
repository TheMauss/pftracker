"use client";

import { useEffect, useState, useCallback } from "react";
import DeFiPositions from "@/components/DeFiPositions";
import AIAnalysis from "@/components/AIAnalysis";
import type { PortfolioResponse, RawDefiPosition } from "@/lib/types";

export default function DefiPage() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) setPortfolio(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const allPositions: RawDefiPosition[] = portfolio?.wallets
    .flatMap((w) => w.defi_positions) ?? [];

  const totalLend = allPositions.filter((p) => !p.is_debt).reduce((s, p) => s + p.value_usd, 0);
  const totalBorrow = allPositions.filter((p) => p.is_debt).reduce((s, p) => s + p.value_usd, 0);

  // Yield summary per protocol
  const yieldsByProtocol = new Map<string, { supply: number; apy: number; count: number }>();
  for (const p of allPositions.filter((p) => !p.is_debt && p.apy !== null && p.apy !== undefined)) {
    const key = `${p.protocol}:${p.chain}`;
    const existing = yieldsByProtocol.get(key) ?? { supply: 0, apy: 0, count: 0 };
    yieldsByProtocol.set(key, {
      supply: existing.supply + p.value_usd,
      apy: existing.apy + (p.apy! * p.value_usd),
      count: existing.count + 1,
    });
  }

  const yieldTable = Array.from(yieldsByProtocol.entries())
    .map(([key, data]) => ({
      key,
      protocol: key.split(":")[0],
      chain: key.split(":")[1],
      supply: data.supply,
      weightedApy: data.supply > 0 ? data.apy / data.supply : 0,
    }))
    .sort((a, b) => b.supply - a.supply);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">DeFi pozice</h1>
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors disabled:opacity-50"
        >
          {loading ? "Načítám..." : "Obnovit"}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Celkem depositováno", value: `$${totalLend.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`, class: "text-green-400" },
          { label: "Celkem půjčeno", value: `$${totalBorrow.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`, class: "text-red-400" },
          { label: "Net DeFi", value: `$${(totalLend - totalBorrow).toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`, class: (totalLend - totalBorrow) >= 0 ? "text-white" : "text-red-400" },
        ].map((card) => (
          <div key={card.label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="text-xs text-gray-500 mb-1">{card.label}</div>
            <div className={`text-2xl font-bold tabular-nums ${card.class}`}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Yield comparison table */}
      {yieldTable.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800">
          <div className="p-4 border-b border-gray-800">
            <h2 className="font-semibold text-white">Yield přehled</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-800">
                <th className="text-left px-4 py-2">Protokol</th>
                <th className="text-left px-4 py-2">Chain</th>
                <th className="text-right px-4 py-2">Depositováno</th>
                <th className="text-right px-4 py-2">Vážené APY</th>
              </tr>
            </thead>
            <tbody>
              {yieldTable.map((row) => (
                <tr key={row.key} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2.5 text-white font-medium">{row.protocol.toUpperCase()}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{row.chain}</td>
                  <td className="px-4 py-2.5 text-right text-white tabular-nums">
                    ${row.supply.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className="text-green-400">{row.weightedApy.toFixed(2)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-wallet DeFi positions */}
      {loading ? (
        <div className="h-32 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />
      ) : portfolio?.wallets.map((w) => (
        w.defi_positions.length > 0 && (
          <DeFiPositions
            key={w.wallet.id}
            positions={w.defi_positions}
            walletLabel={w.wallet.label ?? `Peněženka ${w.wallet.id} (${w.wallet.chain})`}
          />
        )
      ))}

      {allPositions.length === 0 && !loading && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center text-gray-500">
          Žádné DeFi pozice. Ujisti se, že máš přidané peněženky na správných chainech.
        </div>
      )}

      <AIAnalysis defaultFocus="yield optimalizace a přesuny mezi DeFi protokoly" />
    </div>
  );
}
