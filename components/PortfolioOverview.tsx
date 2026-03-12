"use client";

import type { PortfolioResponse, SnapshotsResponse } from "@/lib/types";
import { usePrivacy, mask } from "@/lib/privacy";
import { FxAmount } from "@/lib/currency";

interface Props {
  portfolio: PortfolioResponse | null;
  history: SnapshotsResponse | null;
  loading: boolean;
}

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
}

function pnlColor(v: number | null): string {
  if (v === null) return "#404040";
  return v >= 0 ? "#3cffa0" : "#ff3d5a";
}

function pnlSign(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  const prefix = v >= 0 ? "+" : "−";
  return `${prefix}${fmtUsd(abs)}`;
}

function pnlPct(v: number | null, base: number | null): string {
  if (v === null || base === null || base === 0) return "";
  const pct = (v / base) * 100;
  return ` (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
}

/* ── Skeleton ─────────────────────────────────────────────────── */
function Skeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="card rounded-2xl h-[100px] animate-pulse" />
      ))}
    </div>
  );
}

/* ── Stat card ────────────────────────────────────────────────── */
function StatCard({
  label,
  value,
  valueColor,
  pct,
  sub,
  subColor,
  accentColor,
  isHero = false,
  fxUsd,
  fxPnl = false,
}: {
  label: string;
  value: string;
  valueColor: string;
  pct?: string | null;
  sub?: string | null;
  subColor?: string;
  accentColor: string;
  isHero?: boolean;
  fxUsd?: number;
  fxPnl?: boolean;
}) {
  return (
    <div
      className="card rounded-2xl p-5 relative overflow-hidden flex flex-col gap-3"
      style={{ minHeight: isHero ? 110 : 100 }}
    >
      {/* Corner glow */}
      <div
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl pointer-events-none"
        style={{ background: `${accentColor}14` }}
      />
      {/* Top hairline */}
      <div
        className="absolute top-0 inset-x-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${accentColor}50 40%, ${accentColor}50 60%, transparent 100%)`,
        }}
      />

      <div className="stat-label">{label}</div>

      <div className="relative">
        <div className="flex items-baseline gap-2 flex-wrap">
          <div
            className="stat-value"
            style={{ color: valueColor, fontSize: isHero ? "1.75rem" : "1.5rem" }}
          >
            {value}
          </div>
          {pct && (
            <span className="text-xs font-semibold tabular-nums" style={{ color: valueColor, opacity: 0.65 }}>
              {pct}
            </span>
          )}
        </div>
        {fxUsd !== undefined && <FxAmount usd={fxUsd} pnl={fxPnl} />}
        {sub && (
          <div className="text-xs font-medium mt-1.5" style={{ color: subColor ?? "#505050" }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────── */
export default function PortfolioOverview({ portfolio, history, loading }: Props) {
  const { hidden } = usePrivacy();
  if (loading) return <Skeleton />;

  const total     = portfolio?.total_usd ?? 0;
  const deposited = portfolio?.defi_deposit_usd ?? 0;
  const borrowed  = portfolio?.defi_borrow_usd ?? 0;
  const ltv       = deposited > 0 ? (borrowed / deposited) * 100 : 0;
  const pnl       = history?.pnl;

  // Derive yesterday's snapshot base: latest_snapshot - pnl1d_snapshot = snap1d value
  // Then compute live PnL: live_total - snap1d
  const snapLatest = history?.history.at(-1)?.total_usd ?? null;
  const pnl1dSnap  = pnl?.total_1d ?? null;
  const snap1dBase = snapLatest !== null && pnl1dSnap !== null ? snapLatest - pnl1dSnap : null;
  const pnl1d      = snap1dBase !== null ? total - snap1dBase : null;

  // For 7d/30d also derive live-based PnL
  const pnl7dSnap   = pnl?.total_7d ?? null;
  const snap7dBase  = snapLatest !== null && pnl7dSnap !== null ? snapLatest - pnl7dSnap : null;
  const pnl7dLive   = snap7dBase !== null ? total - snap7dBase : null;
  const pnl30dSnap  = pnl?.total_30d ?? null;
  const snap30dBase = snapLatest !== null && pnl30dSnap !== null ? snapLatest - pnl30dSnap : null;
  const pnl30dLive  = snap30dBase !== null ? total - snap30dBase : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        label="Celková hodnota"
        value={mask(fmtUsd(total), hidden)}
        valueColor="#3cffa0"
        fxUsd={hidden ? undefined : total}
        sub={pnl1d !== null ? `24h  ${mask(pnlSign(pnl1d), hidden)}${hidden ? "" : pnlPct(pnl1d, snap1dBase)}` : undefined}
        subColor={pnlColor(pnl1d)}
        accentColor="#3cffa0"
        isHero
      />
      <StatCard
        label="DeFi supply"
        value={mask(fmtUsd(deposited), hidden)}
        valueColor="#f0f0f0"
        fxUsd={hidden ? undefined : deposited}
        sub={borrowed > 0 ? `Borrow  ${mask(fmtUsd(borrowed), hidden)}` : "Žádné borrows"}
        subColor={borrowed > 0 ? "#ff3d5a" : "#404040"}
        accentColor="#29b6f6"
      />
      <StatCard
        label="LTV ratio"
        value={`${ltv.toFixed(1)}%`}
        valueColor={ltv > 70 ? "#ff7040" : ltv > 0 ? "#f0f0f0" : "#404040"}
        sub={ltv === 0 ? "Bez páky" : ltv > 70 ? "⚠ Vysoké LTV" : "✓ V pořádku"}
        subColor={ltv > 70 ? "#ff7040" : ltv > 0 ? "#3cffa0" : "#404040"}
        accentColor="#ff7040"
      />
      <StatCard
        label="7d PnL"
        value={mask(pnlSign(pnl7dLive), hidden)}
        pct={hidden ? null : pnlPct(pnl7dLive, snap7dBase) || null}
        valueColor={pnlColor(pnl7dLive)}
        fxUsd={hidden || pnl7dLive === null ? undefined : pnl7dLive}
        fxPnl
        sub={pnl30dLive !== null ? `30d  ${mask(pnlSign(pnl30dLive), hidden)}${hidden ? "" : pnlPct(pnl30dLive, snap30dBase)}` : undefined}
        subColor={pnlColor(pnl30dLive)}
        accentColor={pnl7dLive !== null && pnl7dLive >= 0 ? "#3cffa0" : "#ff3d5a"}
      />
    </div>
  );
}
