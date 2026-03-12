"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import DeFiPositions from "@/components/DeFiPositions";
import AIAnalysis from "@/components/AIAnalysis";
import type { PortfolioResponse, RawDefiPosition } from "@/lib/types";
import { usePrivacy, mask } from "@/lib/privacy";

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
}

function overallHealth(positions: RawDefiPosition[]): { hf: number | null; ltv: number } {
  let totalDeposit = 0;
  let totalBorrow  = 0;
  let minHf: number | null = null;
  for (const p of positions) {
    if (!p.is_debt) totalDeposit += p.value_usd;
    else            totalBorrow  += p.value_usd;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hf = (p.extra_data as any)?.health_factor;
    if (hf != null && (minHf === null || hf < minHf)) minHf = hf;
  }
  const ltv = totalDeposit > 0 ? (totalBorrow / totalDeposit) * 100 : 0;
  return { hf: minHf, ltv };
}

function calcNetApy(positions: RawDefiPosition[]): number {
  let earnWeighted = 0, borrowWeighted = 0, totalDeposit = 0, totalBorrow = 0;
  for (const p of positions) {
    if (!p.is_debt && p.apy != null) { earnWeighted += p.apy * p.value_usd; totalDeposit += p.value_usd; }
    else if (p.is_debt && p.apy != null) { borrowWeighted += Math.abs(p.apy) * p.value_usd; totalBorrow += p.value_usd; }
  }
  const earnApy = totalDeposit > 0 ? earnWeighted / totalDeposit : 0;
  const borrowApy = totalBorrow > 0 ? borrowWeighted / totalBorrow : 0;
  return earnApy - borrowApy;
}

type HfRisk = "safe" | "moderate" | "warning" | "danger" | "none";
function hfRisk(hf: number | null, ltv: number): HfRisk {
  if (ltv === 0) return "none";
  if (hf !== null) {
    if (hf > 2.0) return "safe";
    if (hf > 1.5) return "moderate";
    if (hf > 1.25) return "warning";
    return "danger";
  }
  if (ltv < 40) return "safe";
  if (ltv < 60) return "moderate";
  if (ltv < 75) return "warning";
  return "danger";
}

const RISK: Record<HfRisk, { text: string; color: string; label: string }> = {
  safe:     { text: "#3cffa0", color: "#3cffa0", label: "Low risk" },
  moderate: { text: "#ffb340", color: "#ffb340", label: "Moderate" },
  warning:  { text: "#ff7040", color: "#ff7040", label: "Caution" },
  danger:   { text: "#ff3d5a", color: "#ff3d5a", label: "High risk" },
  none:     { text: "#404040", color: "#ff7040", label: "No borrows" },
};

/* ── Stat card ─────────────────────────────────────────────────────────────── */
function StatCard({
  label, value, valueColor, sub, subColor, accentColor,
}: {
  label: string; value: string; valueColor: string;
  sub?: string; subColor?: string; accentColor: string;
}) {
  return (
    <div className="card rounded-2xl p-5 relative overflow-hidden">
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-3xl pointer-events-none" style={{ background: `${accentColor}12` }} />
      <div className="absolute top-0 inset-x-0 h-px" style={{ background: `linear-gradient(90deg, transparent 0%, ${accentColor}50 50%, transparent 100%)` }} />
      <div className="relative">
        <div className="stat-label mb-3">{label}</div>
        <div className="stat-value" style={{ color: valueColor }}>{value}</div>
        {sub && <div className="text-xs font-medium mt-2" style={{ color: subColor ?? "#505050" }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function DefiPage() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const { hidden } = usePrivacy();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) setPortfolio(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const allPositions = useMemo<RawDefiPosition[]>(
    () => portfolio?.wallets.flatMap((w) => w.defi_positions) ?? [],
    [portfolio]
  );

  const lendingPositions = allPositions.filter((p) => ["lend","borrow"].includes(p.position_type));
  const { hf, ltv } = overallHealth(lendingPositions);
  const netApy = calcNetApy(lendingPositions);
  const risk   = hfRisk(hf, ltv);
  const riskInfo = RISK[risk];

  const totalDeposit = lendingPositions.filter((p) => !p.is_debt).reduce((s, p) => s + p.value_usd, 0);
  const totalBorrow  = lendingPositions.filter((p) =>  p.is_debt).reduce((s, p) => s + p.value_usd, 0);

  const yieldsByProtocol = useMemo(() => {
    const map = new Map<string, { supply: number; earn: number; borrow: number; cost: number }>();
    for (const p of lendingPositions) {
      const key = `${p.protocol}:${p.chain}`;
      const ex = map.get(key) ?? { supply: 0, earn: 0, borrow: 0, cost: 0 };
      if (!p.is_debt) { ex.supply += p.value_usd; ex.earn += (p.apy ?? 0) * p.value_usd; }
      else            { ex.borrow += p.value_usd; ex.cost += Math.abs(p.apy ?? 0) * p.value_usd; }
      map.set(key, ex);
    }
    return Array.from(map.entries())
      .map(([key, d]) => ({
        key,
        protocol: key.split(":")[0],
        chain: key.split(":")[1],
        supply: d.supply,
        borrow: d.borrow,
        supplyApy: d.supply > 0 ? d.earn / d.supply : 0,
        borrowApy: d.borrow > 0 ? d.cost / d.borrow : 0,
        netApy: (d.supply > 0 ? d.earn / d.supply : 0) - (d.borrow > 0 ? d.cost / d.borrow : 0),
      }))
      .sort((a, b) => (b.supply + b.borrow) - (a.supply + a.borrow));
  }, [lendingPositions]);

  const avgEarnApy  = yieldsByProtocol.reduce((s, r) => s + r.supplyApy * r.supply, 0) / (totalDeposit || 1);
  const avgBorrowApy = yieldsByProtocol.reduce((s, r) => s + r.borrowApy * r.borrow, 0) / (totalBorrow || 1);

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "#f0f0f0" }}>DeFi pozice</h1>
          <p className="text-xs mt-0.5" style={{ color: "#404040" }}>{allPositions.length} aktivních pozic</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="btn-ghost text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5">
          <span className={loading ? "animate-spin" : ""}>↻</span>
          {loading ? "Načítám" : "Obnovit"}
        </button>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Supply"
          value={mask(fmtUsd(totalDeposit), hidden)}
          valueColor="#3cffa0"
          sub={`Earn  +${avgEarnApy.toFixed(2)}%`}
          subColor="#3cffa0"
          accentColor="#3cffa0"
        />
        <StatCard
          label="Borrow"
          value={mask(fmtUsd(totalBorrow), hidden)}
          valueColor="#ff3d5a"
          sub={`Pay  -${avgBorrowApy.toFixed(2)}%`}
          subColor="#ff3d5a"
          accentColor="#ff3d5a"
        />
        <StatCard
          label="Net APY"
          value={`${netApy >= 0 ? "+" : ""}${netApy.toFixed(2)}%`}
          valueColor={netApy >= 0 ? "#ff7040" : "#ff3d5a"}
          sub={`Net  ${fmtUsd(totalDeposit - totalBorrow)}`}
          subColor="#606060"
          accentColor="#ff7040"
        />
        <StatCard
          label="Health Factor"
          value={hf !== null ? hf.toFixed(2) : ltv > 0 ? `${ltv.toFixed(0)}% LTV` : "—"}
          valueColor={riskInfo.color}
          sub={riskInfo.label}
          subColor={riskInfo.text}
          accentColor={riskInfo.color}
        />
      </div>

      {/* Yield breakdown table */}
      {yieldsByProtocol.length > 0 && (
        <div className="card rounded-2xl overflow-hidden">
          <div
            className="px-5 py-3.5 flex items-center justify-between"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
          >
            <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Yield přehled</h2>
            <span className="stat-label">weighted APY per protokol</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {["Protokol", "Chain", "Supply", "Borrow", "Earn APY", "Pay APY", "Net APY"].map((h, i) => (
                    <th key={h} className={`px-5 py-2.5 stat-label ${i >= 2 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {yieldsByProtocol.map((row) => (
                  <tr
                    key={row.key}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td className="px-5 py-3 font-bold uppercase tracking-wide text-xs" style={{ color: "#c0c0c0" }}>
                      {row.protocol}
                    </td>
                    <td className="px-5 py-3" style={{ color: "#404040" }}>{row.chain}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold" style={{ color: "#f0f0f0" }}>
                      {mask(fmtUsd(row.supply), hidden)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums" style={{ color: "#606060" }}>
                      {row.borrow > 0 ? mask(fmtUsd(row.borrow), hidden) : <span style={{ color: "#252525" }}>—</span>}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold" style={{ color: "#3cffa0" }}>
                      +{row.supplyApy.toFixed(2)}%
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {row.borrowApy > 0
                        ? <span className="font-semibold" style={{ color: "#ff3d5a" }}>−{row.borrowApy.toFixed(2)}%</span>
                        : <span style={{ color: "#252525" }}>—</span>}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-bold" style={{ color: row.netApy >= 0 ? "#ff7040" : "#ff3d5a" }}>
                      {row.netApy >= 0 ? "+" : ""}{row.netApy.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Positions */}
      {loading ? (
        <div className="space-y-3">
          <div className="h-48 card rounded-2xl animate-pulse" />
          <div className="h-32 card rounded-2xl animate-pulse" />
        </div>
      ) : (
        <>
          {/* Aggregated view (default) */}
          {!showDetail && allPositions.length > 0 && (
            <DeFiPositions positions={allPositions} />
          )}

          {/* Per-wallet detail view */}
          {showDetail && portfolio?.wallets.map((w) =>
            w.defi_positions.length > 0 && (
              <DeFiPositions
                key={w.wallet.id}
                positions={w.defi_positions}
                walletLabel={w.wallet.label ?? `${w.wallet.chain} · ${w.wallet.address.slice(0, 8)}…`}
              />
            )
          )}

          {/* Detail toggle */}
          {allPositions.length > 0 && (portfolio?.wallets.length ?? 0) > 1 && (
            <div className="flex justify-center">
              <button
                onClick={() => setShowDetail((v) => !v)}
                className="btn-ghost text-xs px-4 py-2 rounded-xl"
              >
                {showDetail ? "← Souhrn" : "Detail per peněženka →"}
              </button>
            </div>
          )}
        </>
      )}

      {allPositions.length === 0 && !loading && (
        <div
          className="card rounded-2xl p-16 text-center text-xs"
          style={{ color: "#303030" }}
        >
          Žádné DeFi pozice. Přidej peněženky na správných chainech.
        </div>
      )}

      <AIAnalysis defaultFocus="yield optimalizace a rizika borrowů" />
    </div>
  );
}
