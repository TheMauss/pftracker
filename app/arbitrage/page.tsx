"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import type { FundingHistoryChartPoint } from "@/app/api/arbitrage/history/route";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceArbitrage {
  asset: string;
  hl_price: number | null;
  lighter_price: number | null;
  spread_pct: number | null;
  net_pct: number | null;
  net_usd: number | null;
  rt_fee_pct: number;
  rt_fee_usd: number;
  direction: "short_hl_long_lighter" | "short_lighter_long_hl" | null;
  profitable: boolean;
}

interface VenueFunding {
  venue: string;
  funding_8h_pct: number;
  oi_usd: number;
  mark_price_usd?: number;
}

interface DeltaNeutralStrategy {
  type: "perps_spot" | "perps_perps";
  label: string;
  venue_long: string;
  venue_short: string;
  daily_income_pct: number;
  daily_income_usd: number;
  annual_apy: number;
  annual_yield_usd: number;
  total_fee_pct: number;
  rt_fee_usd: number;
  breakeven_days: number | null;
  apy_1h: number | null;
  apy_24h: number | null;
}

interface DeltaNeutralAsset {
  asset: string;
  hl: VenueFunding | null;
  lighter: VenueFunding | null;
  strategies: DeltaNeutralStrategy[];
}

interface ArbitrageApiResponse {
  price_arb: PriceArbitrage[];
  delta_neutral: DeltaNeutralAsset[];
  fetched_at: string;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (n >= 10_000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 100)    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function fmtOi(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n > 0)    return `$${(n / 1e3).toFixed(0)}K`;
  return "–";
}

function apyColor(apy: number): string {
  if (apy >= 25) return "#3cffa0";
  if (apy >= 12) return "#00d484";
  if (apy >= 5)  return "#ffb340";
  return "#909090";
}

function fundingColor(pct: number): string {
  if (pct > 0.03) return "#3cffa0";
  if (pct > 0.01) return "#00d484";
  if (pct > 0)    return "#ffb340";
  if (pct < 0)    return "#ff3d5a";
  return "#404040";
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function ApyDelta({ now, prev }: { now: number; prev: number | null }) {
  if (prev === null) return <span style={{ color: "#303030" }}>–</span>;
  const diff = now - prev;
  const color = Math.abs(diff) < 0.5 ? "#606060" : diff > 0 ? "#3cffa0" : "#ff3d5a";
  const arrow = Math.abs(diff) < 0.5 ? "" : diff > 0 ? " ↑" : " ↓";
  return (
    <span style={{ color }}>
      {prev.toFixed(1)}%{arrow}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ArbitragePage() {
  const [data, setData]       = useState<ArbitrageApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [age, setAge]         = useState("–");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/arbitrage");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!data) return;
    const id = setInterval(() => setAge(timeAgo(data.fetched_at)), 1000);
    return () => clearInterval(id);
  }, [data]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "#f0f0f0" }}>Arbitrage</h1>
          <p className="text-xs mt-0.5" style={{ color: "#404040" }}>
            Cenová arbitráž + Delta Neutral · HL vs Lighter
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-[10px] tabular-nums" style={{ color: "#303030" }}>
              data před {age}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="btn-ghost text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5"
          >
            <span className={loading ? "animate-spin" : ""}>↻</span>
            {loading ? "Načítám" : "Obnovit"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          <div className="h-48 card rounded-2xl animate-pulse" />
          <div className="h-64 card rounded-2xl animate-pulse" />
        </div>
      )}

      {data && !loading && (
        <>
          {data.errors.length > 0 && (
            <div
              className="rounded-xl p-3 text-xs space-y-1"
              style={{ background: "rgba(255,61,90,0.07)", border: "1px solid rgba(255,61,90,0.2)", color: "#ff6b80" }}
            >
              {data.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          <PriceArbSection rows={data.price_arb} />

          {data.delta_neutral.length > 0 && (
            <DeltaNeutralSection assets={data.delta_neutral} />
          )}
        </>
      )}
    </div>
  );
}

// ─── Price Arbitrage section ──────────────────────────────────────────────────

function PriceArbSection({ rows }: { rows: PriceArbitrage[] }) {
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const anyProfitable = rows.some((r) => r.profitable);

  return (
    <div className="card rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Cenová arbitráž</h2>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "rgba(255,112,64,0.1)", color: "#ff7040", border: "1px solid rgba(255,112,64,0.2)" }}
          >HL Perp</span>
          <span className="text-[10px]" style={{ color: "#404040" }}>vs</span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "rgba(56,189,248,0.1)", color: "#29b6f6", border: "1px solid rgba(56,189,248,0.2)" }}
          >Lighter Perp</span>
        </div>
        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "#404040" }}>
          Short dražší burzu, long levnější — profit při konvergenci cen.
          RT fee = 2 × HL (0.035%) + 2 × Lighter (0.05%) = <span style={{ color: "#606060" }}>0.17% = $170 na $100k</span>.{" "}
          <span style={{ color: "#ffb340" }}>Min. spread pro profit: 0.17%</span>
          {anyProfitable && (
            <span style={{ color: "#3cffa0" }}> · ✓ Příležitost nalezena</span>
          )}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {["Asset", "HL Perp", "Lighter Perp", "Spread", "Net @$100k", "RT fee", "Směr"].map((h, i) => (
                <th key={h} className={`px-5 py-2.5 stat-label ${i >= 1 ? "text-right" : "text-left"}`}>{h}</th>
              ))}
              <th className="px-4 py-2.5 stat-label text-center">Chart</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isExpanded = expandedAsset === row.asset;
              return (
                <React.Fragment key={row.asset}>
                  <PriceArbRow
                    row={row}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedAsset(isExpanded ? null : row.asset)}
                  />
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", padding: 0 }}>
                        <PriceArbChart asset={row.asset} rtFeePct={row.rt_fee_pct} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 text-[10px]" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "#303030" }}>
        Ceny: HL allMids (mark price) · Lighter mid = (best bid + best ask) / 2.
        Spread = |HL − Lighter| / průměr × 100. Kalkulace na pozici $100k — BTC taker na Lighter může být 0%.
        Chart ukazuje spread a net profit v čase — ukládáno každých ~15 min.
      </div>
    </div>
  );
}

function PriceArbRow({
  row, isExpanded, onToggle,
}: { row: PriceArbitrage; isExpanded: boolean; onToggle: () => void }) {
  const hasData = row.hl_price !== null && row.lighter_price !== null;

  return (
    <tr
      style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      <td className="px-5 py-3 font-bold" style={{ color: "#f0f0f0" }}>{row.asset}</td>

      <td className="px-5 py-3 text-right tabular-nums font-semibold" style={{ color: "#ff7040" }}>
        {row.hl_price ? `$${fmtPrice(row.hl_price)}` : <span style={{ color: "#252525" }}>–</span>}
      </td>

      <td className="px-5 py-3 text-right tabular-nums font-semibold" style={{ color: "#29b6f6" }}>
        {row.lighter_price ? `$${fmtPrice(row.lighter_price)}` : <span style={{ color: "#252525" }}>–</span>}
      </td>

      <td className="px-5 py-3 text-right tabular-nums">
        {hasData && row.spread_pct !== null ? (
          <span className="font-bold" style={{ color: row.profitable ? "#3cffa0" : row.spread_pct > 0.05 ? "#ffb340" : "#505050" }}>
            {row.spread_pct.toFixed(4)}%
          </span>
        ) : <span style={{ color: "#252525" }}>–</span>}
      </td>

      <td className="px-5 py-3 text-right tabular-nums">
        {hasData && row.net_pct !== null && row.net_usd !== null ? (
          <>
            <div className="font-bold" style={{ color: row.profitable ? "#3cffa0" : "#ff3d5a" }}>
              {row.net_usd > 0 ? "+" : ""}${row.net_usd.toLocaleString()}
            </div>
            <div className="text-[10px]" style={{ color: row.profitable ? "#2a8a60" : "#7a2030" }}>
              {row.net_pct > 0 ? "+" : ""}{row.net_pct.toFixed(4)}%
            </div>
          </>
        ) : <span style={{ color: "#252525" }}>–</span>}
      </td>

      <td className="px-5 py-3 text-right tabular-nums">
        <div style={{ color: "#404040" }}>${row.rt_fee_usd.toLocaleString()}</div>
        <div className="text-[10px]" style={{ color: "#303030" }}>{row.rt_fee_pct.toFixed(4)}%</div>
      </td>

      <td className="px-5 py-3 text-right">
        {row.direction && hasData ? (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={row.direction === "short_hl_long_lighter"
              ? { background: "rgba(255,112,64,0.1)", color: "#ff7040" }
              : { background: "rgba(56,189,248,0.1)", color: "#29b6f6" }}
          >
            {row.direction === "short_hl_long_lighter" ? "Short HL · Long Lighter" : "Short Lighter · Long HL"}
          </span>
        ) : <span style={{ color: "#252525" }}>–</span>}
      </td>

      <td className="px-4 py-3 text-center">
        <button
          onClick={onToggle}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{
            background: isExpanded ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
            color: isExpanded ? "#c0c0c0" : "#505050",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {isExpanded ? "▲" : "▼"}
        </button>
      </td>
    </tr>
  );
}

// ─── Price Arb Chart ──────────────────────────────────────────────────────────

interface PriceArbPoint {
  fetched_at: string;
  hl_price: number;
  lt_price: number;
  spread_pct: number;
  net_pct: number;
}

function PriceArbChart({ asset, rtFeePct }: { asset: string; rtFeePct: number }) {
  const [points, setPoints] = useState<PriceArbPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours]   = useState(48);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/arbitrage/price-history?asset=${asset}&hours=${h}`);
      if (res.ok) setPoints((await res.json()).points);
    } finally {
      setLoading(false);
    }
  }, [asset]);

  useEffect(() => { load(hours); }, [load, hours]);

  const chartData = (points ?? []).map((p) => ({
    t:      new Date(p.fetched_at).getTime(),
    spread: p.spread_pct,
    net:    p.net_pct,
  }));

  const hasData = chartData.length > 0;

  const timeFmt = (v: number) => {
    const d = new Date(v);
    return hours <= 24
      ? `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`
      : `${d.getDate()}.${(d.getMonth() + 1).toString()} ${d.getHours().toString().padStart(2, "0")}h`;
  };

  return (
    <div className="px-5 py-4" style={{ background: "rgba(255,255,255,0.015)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-semibold" style={{ color: "#606060" }}>
          Spread history · {asset} · HL vs Lighter
        </div>
        <div className="flex gap-1">
          {[{ h: 6, label: "6h" }, { h: 24, label: "24h" }, { h: 48, label: "48h" }, { h: 168, label: "7d" }].map(({ h, label }) => (
            <button
              key={h}
              onClick={() => { setHours(h); load(h); }}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: hours === h ? "rgba(255,255,255,0.08)" : "transparent",
                color: hours === h ? "#c0c0c0" : "#404040",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-36 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.03)" }} />
      ) : !hasData ? (
        <div className="h-36 flex items-center justify-center text-xs" style={{ color: "#303030" }}>
          Zatím žádná historická data — ukládá se každých ~15 min.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
                tickFormatter={timeFmt}
                tick={{ fontSize: 9, fill: "#404040" }} axisLine={false} tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => `${v.toFixed(3)}%`}
                tick={{ fontSize: 9, fill: "#404040" }} axisLine={false} tickLine={false} width={44}
              />
              <Tooltip
                contentStyle={{ background: "#141414", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11 }}
                labelFormatter={(v) => new Date(v as number).toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                formatter={(v, name) => [`${(v as number).toFixed(4)}%`, name === "spread" ? "Spread" : "Net profit"]}
              />
              {/* Fee threshold line */}
              <ReferenceLine y={rtFeePct} stroke="#ffb340" strokeDasharray="4 3" strokeWidth={1} label={{ value: "min spread", fontSize: 9, fill: "#ffb340", position: "insideTopRight" }} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
              {/* Spread line */}
              <Line type="monotone" dataKey="spread" dot={false} strokeWidth={1.5} stroke="#909090" connectNulls name="spread" />
              {/* Net profit line */}
              <Line type="monotone" dataKey="net" dot={false} strokeWidth={1.5} stroke="#3cffa0" connectNulls name="net" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-1.5 text-[9px]" style={{ color: "#404040" }}>
            <span className="flex items-center gap-1"><span style={{ display: "inline-block", width: 12, height: 2, background: "#909090" }} /> Spread</span>
            <span className="flex items-center gap-1"><span style={{ display: "inline-block", width: 12, height: 2, background: "#3cffa0" }} /> Net profit</span>
            <span className="flex items-center gap-1"><span style={{ display: "inline-block", width: 12, height: 2, background: "#ffb340" }} /> Min. spread (RT fee)</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Delta Neutral section ────────────────────────────────────────────────────

function DeltaNeutralSection({ assets }: { assets: DeltaNeutralAsset[] }) {
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);

  const allStrategies = assets
    .flatMap((a) => a.strategies.map((s) => ({ asset: a.asset, ...s })))
    .sort((a, b) => {
      if (a.breakeven_days === null && b.breakeven_days === null) return 0;
      if (a.breakeven_days === null) return 1;
      if (b.breakeven_days === null) return -1;
      return a.breakeven_days - b.breakeven_days;
    });

  const hasHistData = allStrategies.some((s) => s.apy_1h !== null || s.apy_24h !== null);

  return (
    <div className="card rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Delta Neutral · Funding Arbitrage</h2>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(255,112,64,0.1)", color: "#ff7040", border: "1px solid rgba(255,112,64,0.2)" }}>HL</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(56,189,248,0.1)", color: "#29b6f6", border: "1px solid rgba(56,189,248,0.2)" }}>Lighter</span>
        </div>
        <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: "#404040" }}>
          Nulová delta expozice — výnos z funding rate diferenciálu. Kalkulace s{" "}
          <span style={{ color: "#ffb340" }}>2× pákou</span> ($100k kapitál → $200k notional).{" "}
          <span style={{ color: "#606060" }}>Perps/Spot RT:</span> 2 × (HL spot + HL perp) = 2 × 0.07% = 0.14% = $280.{" "}
          <span style={{ color: "#606060" }}>Perps/Perps RT:</span> 2 × (HL + Lighter) = 2 × 0.085% = 0.17% = $340.{" "}
          <span style={{ color: "#606060" }}>Funding se mění každé 8h.</span>
          {!hasHistData && (
            <span style={{ color: "#303030" }}> · 1h/24h data se začnou zobrazovat po prvním obnovení.</span>
          )}
        </p>
      </div>

      {/* Funding rate comparison */}
      <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="stat-label mb-3">Live funding rates (8h)</div>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <th className="text-left py-1.5 w-24 stat-label">Venue</th>
              {assets.map((a) => (
                <th key={a.asset} className="text-right py-1.5 px-3 font-bold" style={{ color: "#c0c0c0" }}>{a.asset}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <td className="py-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(255,112,64,0.1)", color: "#ff7040" }}>HL Spot</span>
              </td>
              {assets.map((a) => (
                <td key={a.asset} className="py-2 px-3 text-right">
                  {a.hl?.mark_price_usd ? (
                    <span className="tabular-nums" style={{ color: "#505050" }}>${fmtPrice(a.hl.mark_price_usd)}</span>
                  ) : <span style={{ color: "#252525" }}>–</span>}
                  <div className="text-[9px]" style={{ color: "#2a2a2a" }}>no funding</div>
                </td>
              ))}
            </tr>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <td className="py-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(255,112,64,0.1)", color: "#ff7040" }}>HL Perp</span>
              </td>
              {assets.map((a) => (
                <td key={a.asset} className="py-2 px-3 text-right">
                  {a.hl ? (
                    <>
                      <span className="font-mono font-bold" style={{ color: fundingColor(a.hl.funding_8h_pct) }}>
                        {a.hl.funding_8h_pct > 0 ? "+" : ""}{a.hl.funding_8h_pct.toFixed(4)}%
                      </span>
                      <div className="text-[9px]" style={{ color: "#404040" }}>{fmtOi(a.hl.oi_usd)} OI</div>
                    </>
                  ) : <span style={{ color: "#252525" }}>–</span>}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(56,189,248,0.1)", color: "#29b6f6" }}>Lighter</span>
              </td>
              {assets.map((a) => (
                <td key={a.asset} className="py-2 px-3 text-right">
                  {a.lighter ? (
                    <span className="font-mono font-bold" style={{ color: fundingColor(a.lighter.funding_8h_pct) }}>
                      {a.lighter.funding_8h_pct > 0 ? "+" : ""}{a.lighter.funding_8h_pct.toFixed(4)}%
                    </span>
                  ) : <span style={{ color: "#252525" }}>–</span>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Strategy table */}
      {allStrategies.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {["Asset", "Typ", "Long", "Short", "APY teď", "APY 1h", "APY 24h", "Daily @$100k", "Break-even"].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 stat-label ${i >= 4 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
                <th className="px-4 py-2.5 stat-label text-center">Chart</th>
              </tr>
            </thead>
            <tbody>
              {allStrategies.map((s, i) => {
                const viable = s.breakeven_days !== null;
                const isExpanded = expandedAsset === `${s.asset}_${s.type}_${s.venue_short}`;
                return (
                  <React.Fragment key={i}>
                    <tr
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", opacity: viable ? 1 : 0.3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    >
                      <td className="px-4 py-2.5 font-bold" style={{ color: "#f0f0f0" }}>{s.asset}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                          style={s.type === "perps_spot"
                            ? { background: "rgba(180,120,255,0.1)", color: "#b478ff" }
                            : { background: "rgba(56,189,248,0.1)", color: "#29b6f6" }}
                        >
                          {s.type === "perps_spot" ? "Perps/Spot" : "Perps/Perps"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(255,112,64,0.08)", color: "#ff7040" }}>{s.venue_long}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(56,189,248,0.08)", color: "#29b6f6" }}>{s.venue_short}</span>
                      </td>

                      {/* APY teď */}
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <div className="font-bold" style={{ color: viable ? apyColor(s.annual_apy) : "#303030" }}>
                          {s.annual_apy.toFixed(1)}%
                        </div>
                      </td>

                      {/* APY 1h ago */}
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                        <ApyDelta now={s.annual_apy} prev={s.apy_1h} />
                      </td>

                      {/* APY 24h ago */}
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                        <ApyDelta now={s.annual_apy} prev={s.apy_24h} />
                      </td>

                      {/* Daily */}
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <div style={{ color: viable ? "#909090" : "#303030" }}>
                          ${viable ? s.daily_income_usd.toFixed(0) : "–"}
                        </div>
                        <div className="text-[10px]" style={{ color: viable ? "#505050" : "#252525" }}>
                          {s.daily_income_pct.toFixed(4)}%
                        </div>
                      </td>

                      {/* Break-even */}
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {viable ? (
                          <span style={{ color: s.breakeven_days! <= 3 ? "#3cffa0" : s.breakeven_days! <= 7 ? "#00d484" : s.breakeven_days! <= 14 ? "#ffb340" : "#ff7040" }}>
                            {s.breakeven_days!.toFixed(1)} dní
                          </span>
                        ) : <span style={{ color: "#252525" }}>nevýhodné</span>}
                      </td>

                      {/* Chart toggle */}
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => setExpandedAsset(isExpanded ? null : `${s.asset}_${s.type}_${s.venue_short}`)}
                          className="text-[10px] px-2 py-0.5 rounded"
                          style={{
                            background: isExpanded ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                            color: isExpanded ? "#c0c0c0" : "#505050",
                            border: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded chart row */}
                    {isExpanded && (
                      <tr key={`chart_${i}`}>
                        <td colSpan={10} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", padding: 0 }}>
                          <FundingChart asset={s.asset} strategyType={s.type} venueShort={s.venue_short} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center text-xs" style={{ color: "#303030" }}>
          Žádné aktivní strategie — funding rates nevýhodné.
        </div>
      )}

      <div className="px-5 py-3 text-[10px] leading-relaxed" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "#303030" }}>
        2× páka: $100k kapitál, $200k notional. APY = return na kapitál (funding APY × 2). Break-even = RT fee ÷ daily income (páka se vykrátí).
        Perps/Spot: 2 × (0.035% + 0.035%) = 0.14% = $280. Perps/Perps: 2 × (0.035% + 0.05%) = 0.17% = $340.
        History ukládáno každých ~15 min — 1h/24h sloupce ukazují APY v daný čas s šipkou trendu.
      </div>
    </div>
  );
}

// ─── Inline funding APY chart ─────────────────────────────────────────────────

interface FundingChartProps {
  asset: string;
  strategyType: "perps_spot" | "perps_perps";
  venueShort: string;
}

function FundingChart({ asset, strategyType, venueShort }: FundingChartProps) {
  const [points, setPoints] = useState<FundingHistoryChartPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours]   = useState(48);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/arbitrage/history?asset=${asset}&hours=${h}`);
      if (res.ok) {
        const d = await res.json();
        setPoints(d.points);
      }
    } finally {
      setLoading(false);
    }
  }, [asset]);

  useEffect(() => { load(hours); }, [load, hours]);

  // Pick correct APY series for this strategy
  const apyKey: keyof FundingHistoryChartPoint =
    strategyType === "perps_spot"
      ? "apy_spot"
      : venueShort === "HL Perp"
        ? "apy_pp_hl_short"
        : "apy_pp_lt_short";

  const chartData = (points ?? []).map((p) => ({
    t: new Date(p.fetched_at).getTime(),
    apy: p[apyKey] as number | null,
    hl: p.hl_rate,
    lt: p.lighter_rate,
  }));

  const hasData = chartData.some((d) => d.apy !== null);

  return (
    <div className="px-5 py-4" style={{ background: "rgba(255,255,255,0.015)" }}>
      {/* Controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-semibold" style={{ color: "#606060" }}>
          APY history · {asset} · {strategyType === "perps_spot" ? "Perps/Spot" : `Perps/Perps (Short ${venueShort})`}
        </div>
        <div className="flex gap-1">
          {[
            { h: 6,  label: "6h" },
            { h: 24, label: "24h" },
            { h: 48, label: "48h" },
            { h: 168, label: "7d" },
          ].map(({ h, label }) => (
            <button
              key={h}
              onClick={() => { setHours(h); load(h); }}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: hours === h ? "rgba(255,255,255,0.08)" : "transparent",
                color: hours === h ? "#c0c0c0" : "#404040",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-32 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.03)" }} />
      ) : !hasData ? (
        <div className="h-32 flex items-center justify-center text-xs" style={{ color: "#303030" }}>
          Zatím žádná historická data — data se ukládají každých ~15 min po prvním načtení stránky.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              scale="time"
              tickFormatter={(v) => {
                const d = new Date(v);
                return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
              }}
              tick={{ fontSize: 9, fill: "#404040" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 9, fill: "#404040" }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{ background: "#141414", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11 }}
              labelFormatter={(v) => new Date(v as number).toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              formatter={(v) => [`${(v as number)?.toFixed(2)}%`, "APY"]}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey="apy"
              dot={false}
              strokeWidth={1.5}
              stroke="#3cffa0"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Raw funding rates mini row */}
      {!loading && hasData && chartData.length > 0 && (
        <div className="flex gap-4 mt-2 text-[10px]" style={{ color: "#404040" }}>
          <span>
            HL:{" "}
            <span style={{ color: fundingColor(chartData[chartData.length - 1]?.hl ?? 0) }}>
              {chartData[chartData.length - 1]?.hl !== null
                ? `${(chartData[chartData.length - 1].hl! * 1).toFixed(4)}%/8h`
                : "–"}
            </span>
          </span>
          {chartData[chartData.length - 1]?.lt !== null && (
            <span>
              Lighter:{" "}
              <span style={{ color: fundingColor(chartData[chartData.length - 1]?.lt ?? 0) }}>
                {`${(chartData[chartData.length - 1].lt! * 1).toFixed(4)}%/8h`}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
