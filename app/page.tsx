"use client";

import { useEffect, useState, useCallback } from "react";
import PortfolioOverview from "@/components/PortfolioOverview";
import AllocationChart from "@/components/AllocationChart";
import TokenTable from "@/components/TokenTable";
import AIAnalysis from "@/components/AIAnalysis";
import type { PortfolioResponse, SnapshotsResponse, RawTokenBalance } from "@/lib/types";

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [history, setHistory] = useState<SnapshotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [portRes, histRes] = await Promise.all([
        fetch("/api/portfolio"),
        fetch("/api/snapshots?from=" + new Date(Date.now() - 30 * 86400000).toISOString()),
      ]);
      if (portRes.ok) setPortfolio(await portRes.json());
      if (histRes.ok) setHistory(await histRes.json());
      setLastUpdated(new Date().toLocaleTimeString("cs-CZ"));
    } catch (err) {
      console.error("Failed to fetch portfolio:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const allTokens: RawTokenBalance[] = portfolio?.wallets
    .flatMap((w) => w.tokens)
    .filter((t) => !t.is_derivative) ?? [];

  const unknownCount = portfolio?.unknown_price_count ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-500">
              Aktualizováno: {lastUpdated}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors disabled:opacity-50"
          >
            {loading ? "Načítám..." : "Obnovit"}
          </button>
        </div>
      </div>

      {unknownCount > 0 && (
        <div className="text-xs text-yellow-400/70 bg-yellow-900/20 border border-yellow-900/40 rounded px-3 py-2">
          ⚠ {unknownCount} tokenů s neznámou cenou je vyloučeno z celkové hodnoty.
        </div>
      )}

      <PortfolioOverview portfolio={portfolio} history={history} loading={loading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AllocationChart portfolio={portfolio} />

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="font-semibold text-white mb-3">Peněženky</h2>
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-800 rounded animate-pulse" />
              ))}
            </div>
          ) : !portfolio?.wallets.length ? (
            <p className="text-gray-500 text-sm">
              Žádné peněženky.{" "}
              <a href="/wallets" className="text-indigo-400 hover:underline">
                Přidej první peněženku →
              </a>
            </p>
          ) : (
            <div className="space-y-2">
              {portfolio.wallets.map((w) => (
                <div
                  key={w.wallet.id}
                  className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0"
                >
                  <div>
                    <div className="text-sm text-white">
                      {w.wallet.label ?? "Peněženka " + w.wallet.id}
                    </div>
                    <div className="text-xs text-gray-500">
                      {w.wallet.chain} · {w.wallet.address.slice(0, 10)}...
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-white tabular-nums">
                      ${w.total_usd.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}
                    </div>
                    {(w.defi_deposit_usd > 0 || w.defi_borrow_usd > 0) && (
                      <div className="text-xs text-gray-500">
                        DeFi net: ${(w.defi_deposit_usd - w.defi_borrow_usd).toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <TokenTable tokens={allTokens} title={`Top tokeny (${allTokens.length})`} />

      <AIAnalysis />
    </div>
  );
}
