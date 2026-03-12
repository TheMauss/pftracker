"use client";

import { useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { format, subDays } from "date-fns";
import type { SnapshotsResponse } from "@/lib/types";
import { usePrivacy, mask } from "@/lib/privacy";

type Range = "7d" | "30d" | "90d" | "ytd" | "1y" | "all";
type Mode  = "value" | "performance";

const RANGES: { key: Range; label: string }[] = [
  { key: "7d",  label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "ytd", label: "YTD" },
  { key: "1y",  label: "1R" },
  { key: "all", label: "Vše" },
];

interface Props {
  data: SnapshotsResponse | null;
  /** When provided the chart is locked to this mode (no toggle shown). */
  forceMode?: Mode;
  /** Shared range state — pass when syncing two charts. */
  range?: Range;
  onRangeChange?: (r: Range) => void;
}

function fmtK(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtPct(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function CustomTooltip({ active, payload, label, mode, hidden }: {
  active?: boolean; payload?: { value: number }[]; label?: string; mode: Mode; hidden: boolean;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value ?? 0;
  const isDown = mode === "performance" && val < 0;
  return (
    <div className="rounded-xl px-3.5 py-3 text-xs space-y-1" style={{
      background: "#15151a", border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 16px 40px rgba(0,0,0,0.8)",
    }}>
      <div className="font-semibold" style={{ color: "#505050" }}>{label}</div>
      <div className="font-bold" style={{ color: isDown ? "#ff3d5a" : "#3cffa0" }}>
        {mode === "value" ? mask(fmtK(val), hidden) : fmtPct(val)}
      </div>
    </div>
  );
}

export default function HistoryChart({ data, forceMode, range: extRange, onRangeChange }: Props) {
  const [localRange, setLocalRange] = useState<Range>("30d");
  const { hidden } = usePrivacy();

  const range = extRange ?? localRange;
  const setRange = onRangeChange ?? setLocalRange;
  const mode: Mode = forceMode ?? "value";

  const empty = (
    <div className="card rounded-2xl p-5 h-[220px] flex flex-col gap-3">
      <div className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>
        {mode === "value" ? "Hodnota portfolia" : "Performance"}
      </div>
      <div className="flex-1 flex items-center justify-center text-xs" style={{ color: "#404040" }}>
        Žádná data — snapshot se vytvoří o půlnoci.
      </div>
    </div>
  );

  if (!data?.history?.length) return empty;

  const now = new Date();
  const cutoff = range === "all" ? null
    : range === "ytd" ? new Date(now.getFullYear(), 0, 1)
    : range === "1y"  ? subDays(now, 365)
    : subDays(now, range === "7d" ? 7 : range === "30d" ? 30 : 90);
  const filtered = data.history.filter((h) => !cutoff || new Date(h.taken_at) >= cutoff);
  const baseline = filtered[0]?.total_usd ?? 1;

  const chartData = filtered.map((h) => ({
    date: format(new Date(h.taken_at), "d.M."),
    total: Math.round(h.total_usd),
    perf:  +((h.total_usd / baseline - 1) * 100).toFixed(3),
  }));

  const last  = chartData.at(-1);
  const first = chartData[0];
  const gainPct = last && first && first.total > 0 ? ((last.total / first.total) - 1) * 100 : 0;
  const gainAbs = last && first ? last.total - first.total : 0;
  const isUp  = gainPct >= 0;
  const color = isUp ? "#3cffa0" : "#ff3d5a";

  const dataKey = mode === "value" ? "total" : "perf";
  const vals    = chartData.map((d) => d[dataKey] as number);
  const vMin    = Math.min(...vals);
  const vMax    = Math.max(...vals);
  const pad     = Math.max((vMax - vMin) * 0.14, mode === "performance" ? 0.5 : 1);

  return (
    <div className="card rounded-2xl p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#404040" }}>
            {mode === "value" ? "Hodnota portfolia" : "Performance"}
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold tabular-nums" style={{ color }}>
              {mode === "value"
                ? mask(fmtK(last?.total ?? 0), hidden)
                : fmtPct(gainPct)}
            </span>
            {mode === "performance" && (
              <span className="text-xs font-semibold tabular-nums" style={{ color: `${color}88` }}>
                {gainAbs >= 0 ? "+" : "−"}{hidden ? "••••" : fmtK(Math.abs(gainAbs))}
              </span>
            )}
          </div>
        </div>

        {/* Range selector — only shown on one chart (value), hidden on performance to avoid duplication */}
        {mode === "value" || forceMode === undefined ? (
          <div className="flex gap-1 p-0.5 tab-group rounded-lg">
            {RANGES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setRange(key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${range === key ? "tab-btn-active" : "tab-btn"}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs tabular-nums" style={{ color: "#404040" }}>
            za {range === "all" ? "vše" : range}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${mode}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#404040" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis
            tickFormatter={mode === "value" ? fmtK : (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
            tick={{ fontSize: 9, fill: "#404040" }} tickLine={false} axisLine={false}
            domain={[vMin - pad, vMax + pad]}
          />
          {mode === "performance" && <ReferenceLine y={0} stroke="rgba(255,255,255,0.07)" strokeDasharray="4 3" />}
          <Tooltip content={<CustomTooltip mode={mode} hidden={hidden} />} cursor={{ stroke: `${color}25`, strokeWidth: 1 }} />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5}
            fill={`url(#grad-${mode})`} dot={false}
            activeDot={{ r: 3, fill: color, stroke: "#080808", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
