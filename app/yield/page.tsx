"use client";

import { useEffect, useState, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { usePrivacy, mask } from "@/lib/privacy";

// ─── Types ────────────────────────────────────────────────────────────────────

interface YieldPosition {
  protocol: string; chain: string; asset: string;
  value_usd: number; apy: number; annual_yield_usd: number;
}
interface YieldRate {
  protocol: string; chain: string; asset: string;
  supply_apy: number; borrow_apy: number;
  type?: "variable" | "fixed"; maturity?: string; liquidity_usd?: number;
  risk?: "low" | "medium" | "high";
  category?: "stable" | "native";
  lockup_days?: number;
}
interface RouteLink { label: string; url: string; }
interface YieldRecommendation {
  type: "deploy" | "move";
  from_protocol?: string; from_chain?: string; from_asset?: string;
  to_protocol: string; to_chain: string; asset: string;
  amount_usd: number; current_apy: number; target_apy: number; apy_gain: number;
  daily_gain_usd: number; route_cost_usd: number; bridge_cost_usd: number;
  swap_cost_usd: number; route_method: string; route_notes: string[];
  route_links: RouteLink[];
  breakeven_days: number | null; yield_type?: "variable" | "fixed"; maturity?: string;
}
interface NativeRecommendation {
  type: "stake" | "move";
  asset: string; amount_usd: number;
  from_protocol?: string; from_chain?: string;
  current_apy: number; to_protocol: string; to_chain: string;
  target_apy: number; apy_gain: number;
  daily_gain_usd: number; annual_gain_usd: number;
  url?: string;
}
interface BridgeCosts {
  cctp: Record<string, number>; wormhole: Record<string, number>; swap_fees: Record<string, number>;
  hl_withdrawal_usd: number; hl_hyperevm_tx_usd: number; eth_gas_gwei: number; eth_usd: number; hype_usd: number;
}
interface YieldApiResponse {
  total_stable_deployed_usd: number; weighted_apy: number; annual_yield_usd: number; idle_stable_usd: number;
  stable_positions: YieldPosition[];
  idle_stablecoins: Array<{ chain: string; asset: string; amount_usd: number }>;
  recommendations: YieldRecommendation[];
  total_native_deployed_usd: number; native_weighted_apy: number; native_annual_yield_usd: number; idle_native_usd: number;
  native_positions: YieldPosition[];
  idle_native_tokens: Array<{ chain: string; asset: string; amount_usd: number }>;
  native_recommendations: NativeRecommendation[];
  market_rates: YieldRate[];
  bridge_costs: BridgeCosts; fetched_at: string; errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt     = (n: number) => n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
const fmtApy  = (n: number) => n.toFixed(2) + "%";
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "short", year: "numeric" });
const daysUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

function apyColor(apy: number): string {
  if (apy >= 5) return "#3cffa0";
  if (apy >= 2) return "#ffb340";
  return "#606060";
}

// ─── Section divider ──────────────────────────────────────────────────────────

function SectionDivider({ label, accent }: { label: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 pt-3">
      <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
      <span className="text-[11px] font-bold uppercase tracking-widest px-1" style={{ color: accent }}>{label}</span>
      <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, valueColor, sub, subColor, accentColor }: {
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

// ─── Yield chart ──────────────────────────────────────────────────────────────

const COLORS = [
  "#3cffa0", "#ff7040", "#29b6f6", "#ffb340",
  "#b07aff", "#ff3d5a", "#3db8ff", "#ffd166",
  "#ff6b9d", "#7fdbda", "#f4a261", "#00d67f",
];

type ChartView = "protocol" | "chain" | "asset";
const CHART_VIEWS: { key: ChartView; label: string }[] = [
  { key: "protocol", label: "Protokol" },
  { key: "chain",    label: "Chain" },
  { key: "asset",    label: "Asset" },
];

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: { color: string } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "#15151a", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 16px 40px rgba(0,0,0,0.8)" }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full" style={{ background: d.payload.color }} />
        <span style={{ color: "#909090" }}>{d.name}</span>
      </div>
      <div className="font-bold" style={{ color: "#f0f0f0" }}>
        {d.value >= 1_000 ? `$${(d.value / 1_000).toFixed(1)}K` : `$${d.value}`}
      </div>
    </div>
  );
}

function YieldChart({ positions, idle, annualYield }: {
  positions: YieldPosition[];
  idle: Array<{ chain: string; asset: string; amount_usd: number }>;
  annualYield: number;
}) {
  const [view, setView] = useState<ChartView>("protocol");
  const { hidden } = usePrivacy();

  if (!positions.length && !idle.length) return null;

  const grouped = new Map<string, { value: number; apy_sum: number; isIdle: boolean }>();

  for (const p of positions) {
    const key = view === "protocol" ? p.protocol : view === "chain" ? p.chain : p.asset;
    const ex = grouped.get(key) ?? { value: 0, apy_sum: 0, isIdle: false };
    ex.value   += p.value_usd;
    ex.apy_sum += p.apy * p.value_usd;
    grouped.set(key, ex);
  }

  for (const id of idle) {
    const key = view === "protocol" ? "Idle" : view === "chain" ? id.chain : id.asset;
    const ex = grouped.get(key) ?? { value: 0, apy_sum: 0, isIdle: true };
    ex.value += id.amount_usd;
    if (key === "Idle") ex.isIdle = true;
    grouped.set(key, ex);
  }

  const total = [...grouped.values()].reduce((s, g) => s + g.value, 0);
  const data = [...grouped.entries()]
    .map(([name, g]) => ({
      name,
      value: Math.round(g.value),
      apy: g.value > 0 ? g.apy_sum / g.value : 0,
      isIdle: g.isIdle,
    }))
    .sort((a, b) => b.value - a.value)
    .map((d, i) => ({ ...d, color: d.isIdle ? "#2a2a2a" : COLORS[i % COLORS.length] }));

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Alokace výnosů</h2>
        <div className="flex gap-1 p-0.5 tab-group rounded-lg">
          {CHART_VIEWS.map(({ key, label }) => (
            <button key={key} onClick={() => setView(key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${view === key ? "tab-btn-active" : "tab-btn"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="shrink-0" style={{ width: 160, height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={46} outerRadius={72}
                paddingAngle={2} dataKey="value" strokeWidth={0}>
                {data.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 space-y-1.5 min-w-0">
          {data.map((d, i) => {
            const pct = total > 0 ? (d.value / total) * 100 : 0;
            return (
              <div key={i} className="flex items-center gap-2.5 min-w-0">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.color, border: d.isIdle ? "1px solid #404040" : "none" }} />
                <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                  <span className="text-xs uppercase font-semibold truncate" style={{ color: d.isIdle ? "#404040" : "#707070" }}>{d.name}</span>
                  <div className="flex items-center gap-3 shrink-0 tabular-nums">
                    <span className="text-[10px]" style={{ color: d.isIdle ? "#404040" : apyColor(d.apy) }}>
                      {d.isIdle ? "0%" : `${d.apy.toFixed(1)}%`}
                    </span>
                    <span className="text-[10px]" style={{ color: d.isIdle ? "#383838" : "#404040" }}>
                      {mask(d.value >= 1_000 ? `$${(d.value / 1_000).toFixed(1)}K` : `$${d.value}`, hidden)}
                    </span>
                    <span className="text-[11px] font-semibold" style={{ color: d.isIdle ? "#404040" : "#606060" }}>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="pt-2 mt-1 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#303030" }}>Roční výnos</span>
            <span className="text-xs font-bold tabular-nums" style={{ color: "#3cffa0" }}>
              {mask(annualYield >= 1_000 ? `+$${(annualYield / 1_000).toFixed(1)}K` : `+$${annualYield.toFixed(0)}`, hidden)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Idle badges ──────────────────────────────────────────────────────────────

function IdleBadges({ items }: { items: Array<{ chain: string; asset: string; amount_usd: number }> }) {
  const { hidden } = usePrivacy();
  return (
    <div className="flex flex-wrap gap-2 p-4">
      {items.map((idle, i) => (
        <div key={i} className="rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-xs font-bold tabular-nums" style={{ color: "#ff7040" }}>{mask(`$${fmt(idle.amount_usd)}`, hidden)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: "#505050" }}>{idle.asset} · {idle.chain}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Sub-tab bar ──────────────────────────────────────────────────────────────

function SubTabBar({ tab, setTab, labels }: {
  tab: string; setTab: (v: "positions" | "market") => void;
  labels?: [string, string];
}) {
  const [l1, l2] = labels ?? ["Moje pozice", "Tržní sazby"];
  return (
    <div className="flex gap-1 p-0.5 tab-group rounded-lg">
      {(["positions", "market"] as const).map((v, i) => (
        <button key={v} onClick={() => setTab(v)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${tab === v ? "tab-btn-active" : "tab-btn"}`}>
          {i === 0 ? l1 : l2}
        </button>
      ))}
    </div>
  );
}

// ─── Stable recommendation card ───────────────────────────────────────────────

function RecommendationCard({ rec }: { rec: YieldRecommendation }) {
  const [showNotes, setShowNotes] = useState(false);
  const { hidden } = usePrivacy();
  const isDeploy = rec.type === "deploy";
  const isFixed  = rec.yield_type === "fixed";
  const accentColor = isDeploy ? "#3cffa0" : "#ff7040";

  return (
    <div className="rounded-xl p-4 relative overflow-hidden"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full" style={{ background: accentColor }} />
      <div className="flex items-start justify-between gap-4 flex-wrap pl-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-bold uppercase tracking-wide text-[10px]" style={{ color: accentColor }}>
              {isDeploy ? "Nasadit" : "Přesunout"}
            </span>
            <span className="font-bold tabular-nums" style={{ color: "#f0f0f0" }}>{mask(`$${fmt(rec.amount_usd)}`, hidden)}</span>
            {rec.type === "move" && rec.from_protocol && (
              <>
                <span style={{ color: "#606060" }}>z</span>
                <span className="font-semibold uppercase text-[10px]" style={{ color: "#808080" }}>{rec.from_protocol}</span>
                <span style={{ color: "#404040" }}>·</span>
                <span style={{ color: "#505050" }}>{rec.current_apy.toFixed(2)}%</span>
              </>
            )}
            <span style={{ color: "#404040" }}>→</span>
            <span className="font-bold uppercase text-[10px]" style={{ color: "#c0c0c0" }}>{rec.to_protocol}</span>
            <span style={{ color: "#505050" }}>{rec.to_chain}</span>
            <span className="font-bold tabular-nums" style={{ color: apyColor(rec.target_apy) }}>
              {fmtApy(rec.target_apy)}
            </span>
            {isFixed && <span className="text-[10px] font-bold" style={{ color: "#606060" }}>Fixed</span>}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-[10px]" style={{ color: "#505050" }}>
            <span style={{ color: "#3cffa0" }}>+{rec.apy_gain.toFixed(2)}% APY</span>
            {rec.route_cost_usd > 0 ? (
              <>
                <span style={{ color: "#404040" }}>·</span>
                <span>Náklad <span className="font-bold" style={{ color: "#808080" }}>${rec.route_cost_usd.toFixed(2)}</span></span>
                {rec.breakeven_days !== null && (
                  <>
                    <span style={{ color: "#404040" }}>·</span>
                    <span>Break-even{" "}
                      <span style={{ color: rec.breakeven_days <= 7 ? "#3cffa0" : rec.breakeven_days <= 14 ? "#ffb340" : "#ff7040" }}>
                        {rec.breakeven_days} dní
                      </span>
                    </span>
                  </>
                )}
                {rec.route_notes.length > 0 && (
                  <>
                    <span style={{ color: "#404040" }}>·</span>
                    <button onClick={() => setShowNotes((v) => !v)} className="underline underline-offset-2" style={{ color: "#505050" }}>
                      {showNotes ? "skrýt kroky" : "kroky"}
                    </button>
                  </>
                )}
              </>
            ) : (
              <span style={{ color: "#404040" }}>Stejný chain — bez nákladů</span>
            )}
            {isFixed && rec.maturity && (
              <>
                <span style={{ color: "#404040" }}>·</span>
                <span>Maturita {fmtDate(rec.maturity)} ({daysUntil(rec.maturity)} dní)</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold tabular-nums" style={{ color: "#3cffa0" }}>
            {mask(`+$${fmt(rec.daily_gain_usd * 365)}/rok`, hidden)}
          </div>
          <div className="text-[10px] tabular-nums mt-0.5" style={{ color: "#505050" }}>
            {mask(`+$${rec.daily_gain_usd.toFixed(2)}/den`, hidden)}
          </div>
        </div>
      </div>
      {rec.route_links?.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-3 pl-4">
          {rec.route_links.map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
              className="text-[10px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-opacity hover:opacity-80"
              style={{ background: "rgba(60,255,160,0.07)", color: "#3cffa0", border: "1px solid rgba(60,255,160,0.18)" }}>
              {link.label}<span style={{ opacity: 0.5 }}>↗</span>
            </a>
          ))}
        </div>
      )}
      {showNotes && rec.route_notes.length > 0 && (
        <div className="mt-2 pl-4 space-y-0.5">
          {rec.route_notes.map((note, i) => (
            <div key={i} className="text-[10px] flex items-start gap-1.5" style={{ color: "#505050" }}>
              <span style={{ color: "#303030" }}>{i + 1}.</span><span>{note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Native recommendation card ───────────────────────────────────────────────

function NativeRecommendationCard({ rec }: { rec: NativeRecommendation }) {
  const { hidden } = usePrivacy();
  const isStake = rec.type === "stake";
  const accentColor = "#29b6f6";

  return (
    <div className="rounded-xl p-4 relative overflow-hidden"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full" style={{ background: accentColor }} />
      <div className="flex items-start justify-between gap-4 flex-wrap pl-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-bold uppercase tracking-wide text-[10px]" style={{ color: accentColor }}>
              {isStake ? "Stakovat" : "Přesunout"}
            </span>
            <span className="font-bold tabular-nums" style={{ color: "#f0f0f0" }}>{mask(`$${fmt(rec.amount_usd)}`, hidden)}</span>
            <span className="font-semibold" style={{ color: "#e0e0e0" }}>{rec.asset}</span>
            {!isStake && rec.from_protocol && (
              <>
                <span style={{ color: "#606060" }}>z</span>
                <span className="font-semibold uppercase text-[10px]" style={{ color: "#808080" }}>{rec.from_protocol}</span>
                <span style={{ color: "#505050" }}>{rec.current_apy.toFixed(2)}%</span>
              </>
            )}
            <span style={{ color: "#404040" }}>→</span>
            <span className="font-bold uppercase text-[10px]" style={{ color: "#c0c0c0" }}>{rec.to_protocol}</span>
            <span style={{ color: "#505050" }}>{rec.to_chain}</span>
            <span className="font-bold tabular-nums" style={{ color: apyColor(rec.target_apy) }}>
              {fmtApy(rec.target_apy)}
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap text-[10px]" style={{ color: "#505050" }}>
            <span style={{ color: "#3cffa0" }}>+{rec.apy_gain.toFixed(2)}% APY</span>
            <span style={{ color: "#404040" }}>·</span>
            <span>Bez bridge nákladů</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold tabular-nums" style={{ color: "#3cffa0" }}>
            {mask(`+$${fmt(rec.annual_gain_usd)}/rok`, hidden)}
          </div>
          <div className="text-[10px] tabular-nums mt-0.5" style={{ color: "#505050" }}>
            {mask(`+$${rec.daily_gain_usd.toFixed(2)}/den`, hidden)}
          </div>
        </div>
      </div>
      {rec.url && (
        <div className="flex gap-1.5 flex-wrap mt-3 pl-4">
          <a href={rec.url} target="_blank" rel="noopener noreferrer"
            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-opacity hover:opacity-80"
            style={{ background: "rgba(41,182,246,0.07)", color: "#29b6f6", border: "1px solid rgba(41,182,246,0.18)" }}>
            {rec.to_protocol.charAt(0).toUpperCase() + rec.to_protocol.slice(1)}
            <span style={{ opacity: 0.5 }}>↗</span>
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Positions table ──────────────────────────────────────────────────────────

function PositionsTable({ positions, emptyMessage }: { positions: YieldPosition[]; emptyMessage?: string }) {
  const { hidden } = usePrivacy();
  if (!positions.length) {
    return (
      <div className="p-12 text-center text-xs" style={{ color: "#505050" }}>
        {emptyMessage ?? "Žádné pozice. Data závisí na posledním refresh portfolia."}
      </div>
    );
  }
  const totalValue  = positions.reduce((s, p) => s + p.value_usd, 0);
  const totalAnnual = positions.reduce((s, p) => s + p.annual_yield_usd, 0);
  const avgApy      = totalValue > 0 ? positions.reduce((s, p) => s + p.apy * p.value_usd, 0) / totalValue : 0;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          {["Protokol", "Chain", "Asset", "Depositováno", "APY", "Roční výnos"].map((h, i) => (
            <th key={h} className={`px-5 py-2.5 stat-label ${i >= 3 ? "text-right" : "text-left"}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {positions.map((p, i) => (
          <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
            <td className="px-5 py-3 font-bold uppercase text-[10px] tracking-wide" style={{ color: "#c0c0c0" }}>{p.protocol}</td>
            <td className="px-5 py-3" style={{ color: "#505050" }}>{p.chain}</td>
            <td className="px-5 py-3 font-semibold" style={{ color: "#f0f0f0" }}>{p.asset}</td>
            <td className="px-5 py-3 text-right font-semibold tabular-nums" style={{ color: "#f0f0f0" }}>{mask(`$${fmt(p.value_usd)}`, hidden)}</td>
            <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: apyColor(p.apy) }}>{fmtApy(p.apy)}</td>
            <td className="px-5 py-3 text-right tabular-nums" style={{ color: "#3cffa0" }}>{mask(`$${fmt(p.annual_yield_usd)}/rok`, hidden)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)" }}>
          <td colSpan={3} className="px-5 py-3 text-xs font-semibold" style={{ color: "#606060" }}>Celkem</td>
          <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: "#f0f0f0" }}>{mask(`$${fmt(totalValue)}`, hidden)}</td>
          <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: apyColor(avgApy) }}>{fmtApy(avgApy)}</td>
          <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: "#3cffa0" }}>{mask(`$${fmt(totalAnnual)}/rok`, hidden)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

// ─── Market rates table ───────────────────────────────────────────────────────

const STAKING_DERIVATIVE: Record<string, string> = {
  lido:        "→ stETH",
  jito:        "→ jitoSOL",
  marinade:    "→ mSOL",
  rocketpool:  "→ rETH",
  hyperliquid: "native staking",
};

function MarketRatesTable({ rates }: { rates: YieldRate[] }) {
  const [filter, setFilter] = useState<"all" | "variable" | "fixed">("all");

  const filtered = rates
    .filter((r) => {
      if (filter === "variable") return r.type !== "fixed";
      if (filter === "fixed") return r.type === "fixed";
      return true;
    })
    .sort((a, b) => b.supply_apy - a.supply_apy);

  if (!rates.length) {
    return (
      <div className="p-12 text-center text-xs" style={{ color: "#505050" }}>
        Nepodařilo se načíst tržní sazby.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex gap-1 p-0.5 tab-group rounded-lg">
          {(["all", "variable", "fixed"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${filter === f ? "tab-btn-active" : "tab-btn"}`}>
              {f === "all" ? "Vše" : f === "variable" ? "Variabilní" : "Fixní (Pendle)"}
            </button>
          ))}
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {["Protokol", "Chain", "Asset", "Typ", "Supply APY", "Borrow / Maturita", ...(filter !== "variable" ? ["Likvidita"] : [])].map((h, i) => (
              <th key={h} className={`px-5 py-2.5 stat-label ${i >= 4 ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((r, i) => {
            const isFixed = r.type === "fixed";
            const days = r.maturity ? daysUntil(r.maturity) : null;
            return (
              <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                <td className="px-5 py-3">
                  <div className="font-bold uppercase text-[10px] tracking-wide" style={{ color: "#c0c0c0" }}>{r.protocol}</div>
                  {STAKING_DERIVATIVE[r.protocol] && (
                    <div className="text-[9px] mt-0.5" style={{ color: "#404040" }}>{STAKING_DERIVATIVE[r.protocol]}</div>
                  )}
                </td>
                <td className="px-5 py-3" style={{ color: "#505050" }}>{r.chain}</td>
                <td className="px-5 py-3 font-semibold" style={{ color: "#f0f0f0" }}>{r.asset}</td>
                <td className="px-5 py-3">
                  {(() => {
                    const isVault = r.asset.includes("/");
                    const hasLockup = r.lockup_days !== undefined;
                    const isLiquid = r.lockup_days === 0;
                    return (
                      <div>
                        <span style={{ color: isFixed ? "#ffb340" : isVault ? "#29b6f6" : "#505050" }}>
                          {isFixed ? "Fixní" : isVault ? "CLMM Vault" : "Variabilní"}
                        </span>
                        {r.risk === "medium" && <div className="text-[9px] mt-0.5" style={{ color: "#ffb340" }}>⚠ vyšší riziko</div>}
                        {hasLockup && (
                          <div className="text-[9px] mt-0.5" style={{ color: isLiquid ? "#3cffa0" : "#ff7040" }}>
                            {isLiquid ? "🟢 Liquid" : `🔒 ${r.lockup_days}d unbonding`}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-5 py-3 text-right font-bold tabular-nums" style={{ color: apyColor(r.supply_apy) }}>
                  {fmtApy(r.supply_apy)}
                </td>
                <td className="px-5 py-3 text-right">
                  {isFixed && r.maturity ? (
                    <span className="tabular-nums" style={{ color: days! > 60 ? "#606060" : "#ff7040" }}>
                      {fmtDate(r.maturity)} ({days}d)
                    </span>
                  ) : r.borrow_apy > 0 ? (
                    <span className="tabular-nums font-semibold" style={{ color: "#ff3d5a" }}>{fmtApy(r.borrow_apy)}</span>
                  ) : (
                    <span style={{ color: "#404040" }}>—</span>
                  )}
                </td>
                {filter !== "variable" && (
                  <td className="px-5 py-3 text-right tabular-nums" style={{ color: "#505050" }}>
                    {r.liquidity_usd ? `$${fmt(r.liquidity_usd)}` : "–"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Bridge cost entry ────────────────────────────────────────────────────────

function BridgeCostEntry({ route, cost }: { route: string; cost: number }) {
  const color = cost < 1 ? "#3cffa0" : cost < 3 ? "#ffb340" : "#ff3d5a";
  return (
    <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <span className="text-[10px]" style={{ color: "#505050" }}>{route}</span>
      <span className="text-xs font-bold tabular-nums" style={{ color }}>${cost}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function YieldPage() {
  const [data, setData]         = useState<YieldApiResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [stableTab, setStableTab] = useState<"positions" | "market">("positions");
  const [nativeTab, setNativeTab] = useState<"positions" | "market">("positions");
  const { hidden } = usePrivacy();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/yield");
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const stableRates = data?.market_rates.filter((r) => !r.category || r.category === "stable") ?? [];
  const nativeRates = data?.market_rates.filter((r) => r.category === "native") ?? [];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "#f0f0f0" }}>Yield Management</h1>
          <p className="text-xs mt-0.5" style={{ color: "#505050" }}>Optimalizace výnosů · Stablecoiny & native tokeny</p>
        </div>
        <button onClick={fetchData} disabled={loading}
          className="btn-ghost text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5">
          <span className={loading ? "animate-spin" : ""}>↻</span>
          {loading ? "Načítám" : "Obnovit"}
        </button>
      </div>

      {/* Errors */}
      {data && data.errors?.length > 0 && (
        <div className="rounded-xl p-3 text-xs space-y-1"
          style={{ background: "rgba(255,61,90,0.06)", border: "1px solid rgba(255,61,90,0.15)", color: "#ff6b80" }}>
          {data.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* ══════════ STABLECOINY ══════════ */}
      <SectionDivider label="Stablecoiny" accent="#3cffa0" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="V DeFi"
          value={data ? mask(`$${fmt(data.total_stable_deployed_usd)}`, hidden) : "—"}
          valueColor="#f0f0f0" accentColor="#3cffa0" />
        <StatCard label="Průměrné APY"
          value={data ? fmtApy(data.weighted_apy) : "—"}
          valueColor={data ? apyColor(data.weighted_apy) : "#505050"}
          accentColor="#ffb340" />
        <StatCard label="Roční výnos"
          value={data ? mask(`$${fmt(data.annual_yield_usd)}`, hidden) : "—"}
          valueColor="#3cffa0" sub="při aktuálním APY" accentColor="#3cffa0" />
        <StatCard label="Idle stablecoiny"
          value={data ? mask(`$${fmt(data.idle_stable_usd)}`, hidden) : "—"}
          valueColor={data && data.idle_stable_usd > 100 ? "#ff7040" : "#505050"}
          sub={data && data.idle_stable_usd > 100 ? "Nevydělávají" : "Vše nasazeno"}
          subColor={data && data.idle_stable_usd > 100 ? "#ff7040" : "#3cffa0"}
          accentColor="#ff7040" />
      </div>

      {data && <YieldChart positions={data.stable_positions} idle={data.idle_stablecoins} annualYield={data.annual_yield_usd} />}

      {loading && (
        <div className="space-y-3">
          <div className="h-36 card rounded-2xl animate-pulse" />
          <div className="h-56 card rounded-2xl animate-pulse" />
        </div>
      )}

      {data && !loading && (
        <>
          {/* Stable recommendations */}
          <div className="card rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Doporučení</h2>
                <p className="text-[10px] mt-0.5" style={{ color: "#505050" }}>
                  ETH {data.bridge_costs.eth_gas_gwei} gwei · ${fmt(data.bridge_costs.eth_usd)}/ETH
                  {data.bridge_costs.hype_usd ? ` · HYPE $${data.bridge_costs.hype_usd}` : ""}
                </p>
              </div>
              <span className="text-[10px] tabular-nums" style={{ color: "#505050" }}>{data.recommendations.length} návrhů</span>
            </div>
            <div className="p-4 space-y-2">
              {data.recommendations.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: "#505050" }}>
                  Žádná doporučení — stablecoiny jsou optimálně rozmístěny.
                </p>
              ) : (
                data.recommendations.map((rec, i) => <RecommendationCard key={i} rec={rec} />)
              )}
            </div>
          </div>

          {/* Idle stablecoins */}
          {data.idle_stablecoins.length > 0 && (
            <div className="card rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <h2 className="text-sm font-semibold" style={{ color: "#ff7040" }}>Idle stablecoiny</h2>
                <p className="text-[10px] mt-0.5" style={{ color: "#505050" }}>Nevydělávají — zvaž nasazení</p>
              </div>
              <IdleBadges items={data.idle_stablecoins} />
            </div>
          )}

          {/* Stable positions + market rates */}
          <div className="card rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Přehled výnosů</h2>
              <SubTabBar tab={stableTab} setTab={setStableTab} />
            </div>
            {stableTab === "positions"
              ? <PositionsTable positions={data.stable_positions} />
              : <MarketRatesTable rates={stableRates} />}
          </div>

          {/* Bridge costs */}
          <details className="card rounded-2xl group">
            <summary className="px-5 py-3.5 cursor-pointer flex items-center justify-between select-none text-xs" style={{ color: "#606060" }}>
              <span>Bridge náklady
                <span className="ml-2" style={{ color: "#505050" }}>
                  ETH {data.bridge_costs.eth_gas_gwei} gwei · ${fmt(data.bridge_costs.eth_usd)}/ETH
                </span>
              </span>
              <span style={{ color: "#404040" }}>▼</span>
            </summary>
            <div className="px-5 pb-5 space-y-4 pt-1">
              <div>
                <div className="stat-label mb-2">CCTP — USDC nativní bridge</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                  {Object.entries(data.bridge_costs.cctp).map(([route, cost]) => (
                    <BridgeCostEntry key={route} route={route} cost={cost as number} />
                  ))}
                </div>
              </div>
              {Object.keys(data.bridge_costs.wormhole).length > 0 && (
                <div>
                  <div className="stat-label mb-2">Wormhole — USDT bridge</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {Object.entries(data.bridge_costs.wormhole).map(([route, cost]) => (
                      <BridgeCostEntry key={route} route={route} cost={cost as number} />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="stat-label mb-2">DEX swap fee</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(data.bridge_costs.swap_fees).map(([chain, fee]) => (
                    <div key={chain} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <span className="text-xs" style={{ color: "#606060" }}>{chain}</span>
                      <span className="text-xs font-bold tabular-nums" style={{ color: "#f0f0f0" }}>{((fee as number) * 100).toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-[10px] space-y-1" style={{ color: "#505050" }}>
                <div>HL withdrawal (HyperEVM → Arbitrum): <span style={{ color: "#707070" }}>${data.bridge_costs.hl_withdrawal_usd}</span></div>
                <div>HyperEVM interní tx: <span style={{ color: "#707070" }}>~${data.bridge_costs.hl_hyperevm_tx_usd}</span></div>
              </div>
            </div>
          </details>
        </>
      )}

      {/* ══════════ NATIVE TOKENY ══════════ */}
      <SectionDivider label="Native tokeny" accent="#29b6f6" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="V DeFi / stakingu"
          value={data ? mask(`$${fmt(data.total_native_deployed_usd)}`, hidden) : "—"}
          valueColor="#f0f0f0" accentColor="#29b6f6" />
        <StatCard label="Průměrné APY"
          value={data ? fmtApy(data.native_weighted_apy) : "—"}
          valueColor={data ? apyColor(data.native_weighted_apy) : "#505050"}
          accentColor="#ffb340" />
        <StatCard label="Roční výnos"
          value={data ? mask(`$${fmt(data.native_annual_yield_usd)}`, hidden) : "—"}
          valueColor="#3cffa0" sub="při aktuálním APY" accentColor="#3cffa0" />
        <StatCard label="Idle native"
          value={data ? mask(`$${fmt(data.idle_native_usd)}`, hidden) : "—"}
          valueColor={data && data.idle_native_usd > 100 ? "#ff7040" : "#505050"}
          sub={data && data.idle_native_usd > 100 ? "Nevydělávají" : "Vše nasazeno"}
          subColor={data && data.idle_native_usd > 100 ? "#ff7040" : "#3cffa0"}
          accentColor="#29b6f6" />
      </div>

      {data && <YieldChart positions={data.native_positions} idle={data.idle_native_tokens} annualYield={data.native_annual_yield_usd} />}

      {data && !loading && (
        <>
          {/* Native recommendations */}
          {(data.native_recommendations?.length ?? 0) > 0 && (
            <div className="card rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Doporučení</h2>
                  <p className="text-[10px] mt-0.5" style={{ color: "#505050" }}>Staking & lending příležitosti pro native tokeny</p>
                </div>
                <span className="text-[10px] tabular-nums" style={{ color: "#505050" }}>
                  {data.native_recommendations.length} návrhů
                </span>
              </div>
              <div className="p-4 space-y-2">
                {data.native_recommendations.map((rec, i) => <NativeRecommendationCard key={i} rec={rec} />)}
              </div>
            </div>
          )}

          {/* Idle native tokens */}
          {data.idle_native_tokens.length > 0 && (
            <div className="card rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <h2 className="text-sm font-semibold" style={{ color: "#ff7040" }}>Idle native tokeny</h2>
                <p className="text-[10px] mt-0.5" style={{ color: "#505050" }}>ETH/BTC/SOL/HYPE bez výnosu — zvaž staking nebo DeFi</p>
              </div>
              <IdleBadges items={data.idle_native_tokens} />
            </div>
          )}

          {/* Native positions + market rates */}
          <div className="card rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Native tokeny — přehled</h2>
              <SubTabBar tab={nativeTab} setTab={setNativeTab} />
            </div>
            {nativeTab === "positions" ? (
              <PositionsTable positions={data.native_positions} emptyMessage="Žádné native token pozice v DeFi." />
            ) : nativeRates.length > 0 ? (
              <MarketRatesTable rates={nativeRates} />
            ) : (
              <div className="p-12 text-center text-xs" style={{ color: "#505050" }}>
                Načítám tržní sazby (Lido / Jito / Aave / Hyperlend native)…
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
