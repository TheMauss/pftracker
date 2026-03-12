"use client";

import { useMemo } from "react";
import type { RawDefiPosition } from "@/lib/types";
import { usePrivacy, mask } from "@/lib/privacy";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LendingGroup {
  protocol: string;
  chain: string;
  deposits: RawDefiPosition[];
  borrows: RawDefiPosition[];
  totalDeposit: number;
  totalBorrow: number;
  healthFactor: number | null; // from extra_data (Aave/Hyperlend) or null
  liquidationThresholdPct: number | null;
}

interface OtherGroup {
  positions: RawDefiPosition[];
}

// ─── Protocol colors ──────────────────────────────────────────────────────────

const PROTOCOL_COLOR: Record<string, { dot: string; badge: string }> = {
  kamino:    { dot: "bg-orange-400",  badge: "bg-orange-500/10 text-orange-300 border-orange-500/20" },
  drift:     { dot: "bg-blue-400",    badge: "bg-blue-500/10 text-blue-300 border-blue-500/20" },
  aave:      { dot: "bg-purple-400",  badge: "bg-purple-500/10 text-purple-300 border-purple-500/20" },
  hyperlend: { dot: "bg-emerald-400", badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  compound:  { dot: "bg-green-400",   badge: "bg-green-500/10 text-green-300 border-green-500/20" },
  spark:     { dot: "bg-yellow-400",  badge: "bg-yellow-500/10 text-yellow-300 border-yellow-500/20" },
  morpho:    { dot: "bg-blue-300",    badge: "bg-blue-500/10 text-blue-200 border-blue-500/20" },
  venus:     { dot: "bg-yellow-300",  badge: "bg-yellow-500/10 text-yellow-200 border-yellow-500/20" },
  moonwell:  { dot: "bg-cyan-400",    badge: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20" },
  seamless:  { dot: "bg-indigo-400",  badge: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20" },
  navi:      { dot: "bg-sky-400",     badge: "bg-sky-500/10 text-sky-300 border-sky-500/20" },
  scallop:   { dot: "bg-teal-400",    badge: "bg-teal-500/10 text-teal-300 border-teal-500/20" },
  marginfi:  { dot: "bg-violet-400",  badge: "bg-violet-500/10 text-violet-300 border-violet-500/20" },
  orca:      { dot: "bg-cyan-300",    badge: "bg-cyan-500/10 text-cyan-200 border-cyan-500/20" },
  raydium:   { dot: "bg-indigo-300",  badge: "bg-indigo-500/10 text-indigo-200 border-indigo-500/20" },
  meteora:   { dot: "bg-teal-300",    badge: "bg-teal-500/10 text-teal-200 border-teal-500/20" },
  felix:     { dot: "bg-amber-400",   badge: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  pendle:    { dot: "bg-pink-400",    badge: "bg-pink-500/10 text-pink-300 border-pink-500/20" },
  uniswap:   { dot: "bg-rose-400",    badge: "bg-rose-500/10 text-rose-300 border-rose-500/20" },
  gmx:       { dot: "bg-sky-300",     badge: "bg-sky-500/10 text-sky-200 border-sky-500/20" },
  jlp:       { dot: "bg-green-300",   badge: "bg-green-500/10 text-green-200 border-green-500/20" },
};

function protocolStyle(name: string) {
  return PROTOCOL_COLOR[name] ?? { dot: "bg-slate-400", badge: "bg-slate-500/10 text-slate-300 border-slate-500/20" };
}

// ─── Health factor helpers ────────────────────────────────────────────────────

type Risk = "safe" | "moderate" | "warning" | "danger" | "none";

function calcRisk(hf: number | null, ltv: number): Risk {
  if (ltv === 0) return "none";
  if (hf !== null) {
    if (hf > 2.0)  return "safe";
    if (hf > 1.5)  return "moderate";
    if (hf > 1.25) return "warning";
    return "danger";
  }
  // approximate from LTV when no exact HF
  if (ltv < 40) return "safe";
  if (ltv < 60) return "moderate";
  if (ltv < 75) return "warning";
  return "danger";
}

const RISK_STYLES: Record<Risk, { label: string; color: string }> = {
  safe:     { label: "Low risk",   color: "#3cffa0" },
  moderate: { label: "Moderate",   color: "#ffb340" },
  warning:  { label: "Caution",    color: "#ff7040" },
  danger:   { label: "High risk",  color: "#ff3d5a" },
  none:     { label: "No borrows", color: "#404040" },
};

/** Width 0–100% for the health bar. Full = healthy, low = near liquidation */
function healthBarWidth(hf: number | null, ltv: number): number {
  if (ltv === 0) return 100;
  if (hf !== null) return Math.min(100, Math.max(2, (hf / 4) * 100));
  return Math.max(2, 100 - ltv); // LTV 0%→bar 100%, LTV 100%→bar 0%
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
}

function fmtApy(v: number | null | undefined, isDebt?: boolean) {
  if (v == null) return <span style={{ color: "#333" }}>—</span>;
  return (
    <span style={{ color: isDebt ? "#ff3b5c" : "#00e5a0" }}>
      {isDebt ? "" : "+"}{v.toFixed(2)}%
    </span>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HealthBar({ hf, ltv, liqThreshold }: { hf: number | null; ltv: number; liqThreshold: number | null }) {
  const risk = calcRisk(hf, ltv);
  const styles = RISK_STYLES[risk];
  const barW = healthBarWidth(hf, ltv);

  if (risk === "none") return null;

  return (
    <div className="space-y-1.5">
      {/* Top row: Health Factor (or LTV) + risk label */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest mr-2" style={{ color: "#404040" }}>
              Health Factor
            </span>
            <span className="text-lg font-bold tabular-nums" style={{ color: styles.color }}>
              {hf !== null ? hf.toFixed(2) : "—"}
            </span>
          </div>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide"
            style={{
              background: `${styles.color}14`,
              border: `1px solid ${styles.color}30`,
              color: styles.color,
            }}
          >
            {styles.label}
          </span>
        </div>
        <div className="text-right text-xs" style={{ color: "#505050" }}>
          LTV <span className="font-semibold" style={{ color: styles.color }}>{ltv.toFixed(1)}%</span>
          {liqThreshold && <span className="ml-2" style={{ color: "#303030" }}>/ {liqThreshold.toFixed(0)}% liq.</span>}
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
        {liqThreshold && (
          <div
            className="absolute top-0 bottom-0 w-px z-10"
            style={{ left: `${Math.min(98, liqThreshold)}%`, background: "rgba(255,61,90,0.4)" }}
          />
        )}
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${barW}%`, background: styles.color, boxShadow: `0 0 6px ${styles.color}60` }}
        />
      </div>
    </div>
  );
}

function PositionRow({ pos, isDebt }: { pos: RawDefiPosition; isDebt: boolean }) {
  const { hidden } = usePrivacy();
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-white/[0.03] transition-colors group">
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
          style={isDebt
            ? { background: "rgba(255,59,92,0.1)", color: "#ff6b80" }
            : { background: "rgba(0,229,160,0.08)", color: "#00e5a0" }
          }
        >
          {pos.asset_symbol.slice(0, 2)}
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: "#ededed" }}>{pos.asset_symbol}</div>
          {pos.price_usd && pos.price_usd !== 1 && (
            <div className="text-xs" style={{ color: "#444" }}>
              ${pos.price_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold tabular-nums" style={{ color: isDebt ? "#ff6b80" : "#ededed" }}>
          {isDebt ? "−" : ""}{mask(fmtUsd(pos.value_usd), hidden)}
        </div>
        <div className="text-xs mt-0.5">{fmtApy(pos.apy, isDebt)}</div>
      </div>
    </div>
  );
}

function LpCard({ pos }: { pos: RawDefiPosition }) {
  const { hidden } = usePrivacy();
  const style = protocolStyle(pos.protocol);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ex = pos.extra_data as any;

  // Build token pair label
  let pairLabel = pos.asset_symbol;
  if (ex?.tokenA && ex?.tokenB) pairLabel = `${ex.tokenA.symbol} / ${ex.tokenB.symbol}`;
  else if (ex?.token0 && ex?.token1) pairLabel = `${ex.token0.symbol} / ${ex.token1.symbol}`;
  else if (ex?.tokenX && ex?.tokenY) pairLabel = `${ex.tokenX.symbol} / ${ex.tokenY.symbol}`;

  const inRange = ex?.isInRange ?? ex?.inRange ?? null;
  const apy = ex?.feeApr ?? ex?.apr24h ?? pos.apy;

  return (
    <div
      className="card rounded-2xl p-4 flex items-center justify-between gap-4"
      style={{ borderLeft: "3px solid transparent", borderImage: "linear-gradient(180deg, #8b5cf6, #22d3ee) 1" }}
    >
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${style.dot}`} />
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${style.badge}`}>
              {pos.protocol.toUpperCase()}
            </span>
            <span className="text-xs text-slate-500">{pos.chain}</span>
            <span className="text-xs text-slate-600 capitalize">{pos.position_type}</span>
          </div>
          <div className="text-sm font-semibold text-slate-100 mt-1">{pairLabel}</div>
          {inRange !== null && (
            <div className={`text-xs mt-0.5 font-medium ${inRange ? "text-emerald-400" : "text-orange-400"}`}>
              {inRange ? "● In range" : "○ Out of range"}
            </div>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-base font-bold text-slate-100 tabular-nums">{mask(fmtUsd(pos.value_usd), hidden)}</div>
        {apy != null && (
          <div className="text-xs text-emerald-400 mt-0.5 font-medium">APY +{Number(apy).toFixed(2)}%</div>
        )}
      </div>
    </div>
  );
}

function PerpCard({ pos }: { pos: RawDefiPosition }) {
  const { hidden } = usePrivacy();
  const style = protocolStyle(pos.protocol);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ex = pos.extra_data as any;
  const pnl = ex?.pnl ?? null;
  const side = ex?.side ?? null;

  return (
    <div className="card rounded-2xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${style.dot}`} />
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${style.badge}`}>
              {pos.protocol.toUpperCase()}
            </span>
            {side && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${side === "Long" ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" : "bg-red-500/10 text-red-300 border border-red-500/20"}`}>
                {side}
              </span>
            )}
          </div>
          <div className="text-sm font-semibold text-slate-100 mt-1">{pos.asset_symbol} Perp</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-base font-bold text-slate-100 tabular-nums">{mask(fmtUsd(pos.value_usd), hidden)}</div>
        {pnl != null && (
          <div className={`text-xs mt-0.5 font-medium tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            PnL {pnl >= 0 ? "+" : ""}{mask(fmtUsd(pnl), hidden)}
          </div>
        )}
      </div>
    </div>
  );
}

function LendingCard({ group }: { group: LendingGroup }) {
  const { hidden } = usePrivacy();
  const style = protocolStyle(group.protocol);
  const ltv = group.totalDeposit > 0 ? (group.totalBorrow / group.totalDeposit) * 100 : 0;
  const risk = calcRisk(group.healthFactor, ltv);

  // Net APY: each rate is weighted by its own side (earn/supply, borrow/borrow)
  const earnApy = group.deposits.reduce((sum, p) => sum + (p.apy ?? 0) * p.value_usd, 0) /
    (group.totalDeposit || 1);
  const borrowApy = group.borrows.reduce((sum, p) => sum + Math.abs(p.apy ?? 0) * p.value_usd, 0) /
    (group.totalBorrow || 1);
  const netApy = earnApy - borrowApy;

  return (
    <div className="card rounded-2xl overflow-hidden">
      {/* Protocol header */}
      <div
        className="px-5 py-3.5 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)" }}
      >
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${style.dot}`} />
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide border ${style.badge}`}>
            {group.protocol.toUpperCase()}
          </span>
          <span className="text-xs" style={{ color: "#404040" }}>{group.chain}</span>
        </div>
        <div className="flex items-center gap-4">
          {group.totalBorrow > 0 && (
            <span className="text-xs font-semibold" style={{ color: RISK_STYLES[risk].color }}>
              {RISK_STYLES[risk].label}
            </span>
          )}
          <span className="text-xs tabular-nums" style={{ color: "#505050" }}>
            Net APY{" "}
            <span className="font-bold" style={{ color: netApy >= 0 ? "#ff7040" : "#ff3d5a" }}>
              {netApy >= 0 ? "+" : ""}{netApy.toFixed(2)}%
            </span>
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Health bar (only if borrows exist) */}
        {group.totalBorrow > 0 && (
          <HealthBar
            hf={group.healthFactor}
            ltv={ltv}
            liqThreshold={group.liquidationThresholdPct}
          />
        )}

        {/* Positions grid */}
        <div className={`grid gap-3 ${group.totalBorrow > 0 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
          {/* Supply side */}
          <div>
            <div className="flex items-center justify-between mb-1.5 px-2">
              <span className="stat-label">Supply</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: "#3cffa0" }}>{mask(fmtUsd(group.totalDeposit), hidden)}</span>
            </div>
            <div className="space-y-0.5">
              {group.deposits.map((p, i) => <PositionRow key={i} pos={p} isDebt={false} />)}
            </div>
          </div>

          {/* Borrow side */}
          {group.totalBorrow > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5 px-2">
                <span className="stat-label">Borrow</span>
                <span className="text-xs font-bold tabular-nums" style={{ color: "#ff3d5a" }}>{mask(fmtUsd(group.totalBorrow), hidden)}</span>
              </div>
              <div className="space-y-0.5">
                {group.borrows.map((p, i) => <PositionRow key={i} pos={p} isDebt={true} />)}
              </div>
            </div>
          )}
        </div>

        {/* Footer stats */}
        <div
          className="flex items-center justify-between pt-3 text-xs"
          style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "#404040" }}
        >
          <span>
            Supply <span className="font-semibold" style={{ color: "#3cffa0" }}>{mask(fmtUsd(group.totalDeposit), hidden)}</span>
            {group.totalBorrow > 0 && (
              <> · Borrow <span className="font-semibold" style={{ color: "#ff3d5a" }}>{mask(fmtUsd(group.totalBorrow), hidden)}</span></>
            )}
          </span>
          <span>
            Earn{" "}
            <span className="font-semibold" style={{ color: "#3cffa0" }}>+{earnApy.toFixed(2)}%</span>
            {borrowApy > 0 && (
              <> · Pay <span className="font-semibold" style={{ color: "#ff3d5a" }}>−{borrowApy.toFixed(2)}%</span></>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  positions: RawDefiPosition[];
  walletLabel?: string;
}

const LENDING_TYPES = new Set(["lend", "borrow"]);
const OTHER_TYPES   = new Set(["lp", "vault", "pt", "yt", "cdp", "stake"]);
const PERP_TYPES    = new Set(["perp"]);

export default function DeFiPositions({ positions, walletLabel }: Props) {
  const { lendingGroups, lpPositions, perpPositions } = useMemo(() => {
    const lendMap = new Map<string, LendingGroup>();
    const lps: RawDefiPosition[] = [];
    const perps: RawDefiPosition[] = [];

    for (const pos of positions) {
      if (PERP_TYPES.has(pos.position_type)) {
        perps.push(pos);
        continue;
      }
      if (OTHER_TYPES.has(pos.position_type)) {
        lps.push(pos);
        continue;
      }
      if (!LENDING_TYPES.has(pos.position_type)) continue;

      const key = `${pos.protocol}:${pos.chain}`;
      const g = lendMap.get(key) ?? {
        protocol: pos.protocol,
        chain: pos.chain,
        deposits: [],
        borrows: [],
        totalDeposit: 0,
        totalBorrow: 0,
        healthFactor: null,
        liquidationThresholdPct: null,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ex = pos.extra_data as any;
      if (ex?.health_factor != null && g.healthFactor === null) {
        g.healthFactor = ex.health_factor;
        g.liquidationThresholdPct = ex.liquidation_threshold_pct ?? null;
      }

      if (!pos.is_debt) {
        g.deposits.push(pos);
        g.totalDeposit += pos.value_usd;
      } else {
        g.borrows.push(pos);
        g.totalBorrow += pos.value_usd;
      }

      lendMap.set(key, g);
    }

    return {
      lendingGroups: Array.from(lendMap.values()).sort((a, b) => (b.totalDeposit + b.totalBorrow) - (a.totalDeposit + a.totalBorrow)),
      lpPositions: lps.sort((a, b) => b.value_usd - a.value_usd),
      perpPositions: perps,
    };
  }, [positions]);

  if (positions.length === 0) {
    return (
      <div className="card rounded-2xl p-10 text-center text-slate-500 text-sm">
        Žádné DeFi pozice pro {walletLabel ?? "tuto peněženku"}.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {walletLabel && (
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-1 pt-1">
          {walletLabel}
        </div>
      )}

      {/* Lending positions */}
      {lendingGroups.map((g) => (
        <LendingCard key={`${g.protocol}:${g.chain}`} group={g} />
      ))}

      {/* LP / Vault / PT / YT */}
      {lpPositions.map((pos, i) => (
        <LpCard key={i} pos={pos} />
      ))}

      {/* Perp positions */}
      {perpPositions.map((pos, i) => (
        <PerpCard key={i} pos={pos} />
      ))}
    </div>
  );
}
