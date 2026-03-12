"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { format, subDays } from "date-fns";
import type { BenchmarkPoint } from "@/app/api/benchmark/route";

type Range = "7d" | "30d" | "90d" | "ytd" | "1y" | "all";
type Bench = "btc" | "spx";

const RANGES: { key: Range; label: string }[] = [
  { key: "7d",  label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "ytd", label: "YTD" },
  { key: "1y",  label: "1R" },
  { key: "all", label: "Vše" },
];

const BENCH_COLOR: Record<Bench, string> = {
  btc: "#f7931a",
  spx: "#29b6f6",
};
const BENCH_LABEL: Record<Bench, string> = {
  btc: "BTC",
  spx: "SPX",
};

function fmtPct(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function fmtK(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v}`;
}

function CustomTooltip({ active, payload, label, bench }: {
  active?: boolean;
  payload?: { name: string; value: number; payload: BenchmarkPoint }[];
  label?: string;
  bench: Bench;
}) {
  if (!active || !payload?.length) return null;
  const port = payload.find((p) => p.name === "Portfolio");
  const ref  = payload.find((p) => p.name === BENCH_LABEL[bench]);
  const d    = payload[0]?.payload;
  const refColor = BENCH_COLOR[bench];
  const refVal = bench === "btc" ? d?.btcPrice : d?.spxPrice;
  return (
    <div className="rounded-xl px-3.5 py-3 text-xs space-y-1.5" style={{
      background: "#15151a", border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 16px 40px rgba(0,0,0,0.8)",
    }}>
      <div className="font-semibold mb-1" style={{ color: "#505050" }}>{label}</div>
      {port && (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "#3cffa0" }} />
          <span style={{ color: "#606060" }}>Portfolio</span>
          <span className="font-bold ml-auto pl-4" style={{ color: port.value >= 0 ? "#3cffa0" : "#ff3d5a" }}>
            {fmtPct(port.value)}
          </span>
          <span className="tabular-nums" style={{ color: "#404040" }}>{fmtK(d?.portfolioUsd ?? 0)}</span>
        </div>
      )}
      {ref && (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: refColor }} />
          <span style={{ color: "#606060" }}>{BENCH_LABEL[bench]}</span>
          <span className="font-bold ml-auto pl-4" style={{ color: ref.value >= 0 ? refColor : "#ff3d5a" }}>
            {fmtPct(ref.value)}
          </span>
          <span className="tabular-nums" style={{ color: "#404040" }}>{fmtK(refVal ?? 0)}</span>
        </div>
      )}
    </div>
  );
}

export default function BenchmarkChart() {
  const [allPoints, setAllPoints] = useState<BenchmarkPoint[]>([]);
  const [range, setRange] = useState<Range>("all");
  const [bench, setBench] = useState<Bench>("btc");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/benchmark")
      .then((r) => r.ok ? r.json() : { points: [] })
      .then((d) => { setAllPoints(d.points ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="card rounded-2xl h-[220px] animate-pulse" />;
  if (allPoints.length < 2) return null;

  // Filter by range, fall back to all if < 2 points
  const now = new Date();
  const cutoff = range === "all" ? null
    : range === "ytd" ? new Date(now.getFullYear(), 0, 1)
    : range === "1y"  ? subDays(now, 365)
    : subDays(now, range === "7d" ? 7 : range === "30d" ? 30 : 90);

  const inRange   = cutoff ? allPoints.filter((p) => new Date(p.date) >= cutoff) : allPoints;
  const filtered  = inRange.length >= 2 ? inRange : allPoints;
  const fallback  = inRange.length < 2 && range !== "all";

  const base = filtered[0];
  const benchKey = bench === "btc" ? "btcPrice" : "spxPrice";
  const basePortfolio = base.portfolioUsd;
  const baseBench     = base[benchKey];

  const chartData = filtered.map((p) => ({
    date: format(new Date(p.date), "d.M."),
    portfolio: +((p.portfolioUsd / basePortfolio - 1) * 100).toFixed(3),
    [BENCH_LABEL[bench]]: +((p[benchKey] / baseBench - 1) * 100).toFixed(3),
    portfolioUsd: p.portfolioUsd,
    btcPrice: p.btcPrice,
    spxPrice: p.spxPrice,
  }));

  const last       = chartData.at(-1)!;
  const portGain   = last.portfolio;
  const benchGain  = (last[BENCH_LABEL[bench]] as number) ?? 0;
  const alpha      = portGain - benchGain;
  const portColor  = portGain  >= 0 ? "#3cffa0" : "#ff3d5a";
  const alphaColor = alpha >= 0 ? "#3cffa0" : "#ff3d5a";
  const benchColor = BENCH_COLOR[bench];

  return (
    <div className="card rounded-2xl p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#404040" }}>
              vs. {BENCH_LABEL[bench]} benchmark
            </div>
            {/* BTC / SPX toggle */}
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              {(["btc", "spx"] as Bench[]).map((b) => (
                <button key={b} onClick={() => setBench(b)}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md transition-all duration-100"
                  style={{
                    background: bench === b ? BENCH_COLOR[b] + "22" : "transparent",
                    border: bench === b ? `1px solid ${BENCH_COLOR[b]}44` : "1px solid transparent",
                    color: bench === b ? BENCH_COLOR[b] : "#404040",
                  }}>
                  {BENCH_LABEL[b]}
                </button>
              ))}
            </div>
            {fallback && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-md" style={{ background: "rgba(255,255,255,0.04)", color: "#404040" }}>
                nedostatek dat · vše
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
            <span className="text-xl font-bold tabular-nums" style={{ color: portColor }}>
              {fmtPct(portGain)}
            </span>
            <span className="text-sm tabular-nums" style={{ color: benchColor + "99" }}>
              {BENCH_LABEL[bench]} {fmtPct(benchGain)}
            </span>
            <span className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-md"
              style={{
                background: alpha >= 0 ? "rgba(60,255,160,0.1)" : "rgba(255,61,90,0.1)",
                border: `1px solid ${alpha >= 0 ? "rgba(60,255,160,0.2)" : "rgba(255,61,90,0.2)"}`,
                color: alphaColor,
              }}>
              {alpha >= 0 ? "+" : ""}{alpha.toFixed(2)}% alpha
            </span>
          </div>
        </div>

        {/* Range selector */}
        <div className="flex gap-1 p-0.5 tab-group rounded-lg shrink-0">
          {RANGES.map(({ key, label }) => (
            <button key={key} onClick={() => setRange(key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${range === key ? "tab-btn-active" : "tab-btn"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={155}>
        <LineChart data={chartData} margin={{ top: 2, right: 0, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#404040" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis
            tickFormatter={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
            tick={{ fontSize: 9, fill: "#404040" }} tickLine={false} axisLine={false}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.07)" strokeDasharray="4 3" />
          <Tooltip content={<CustomTooltip bench={bench} />} cursor={{ stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }} />
          <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke="#3cffa0" strokeWidth={1.5}
            dot={false} activeDot={{ r: 3, fill: "#3cffa0", stroke: "#080808", strokeWidth: 2 }} />
          <Line type="monotone" dataKey={BENCH_LABEL[bench]} name={BENCH_LABEL[bench]} stroke={benchColor}
            strokeWidth={1.5} dot={false} strokeDasharray="4 3"
            activeDot={{ r: 3, fill: benchColor, stroke: "#080808", strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
