"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { PortfolioResponse } from "@/lib/types";

const COLORS = [
  "#3cffa0", "#ff7040", "#29b6f6", "#ffb340",
  "#b07aff", "#ff3d5a", "#3db8ff", "#00d67f",
  "#ffd166", "#ff6b9d", "#7fdbda", "#f4a261",
];

interface StockPos {
  ticker: string; display_name: string; category: string;
  quantity: number; price_usd: number | null; value_usd: number | null;
}

type View = "asset" | "category" | "protocol";
const VIEWS: { key: View; label: string }[] = [
  { key: "asset",    label: "Asset" },
  { key: "category", label: "Kategorie" },
  { key: "protocol", label: "Protokol" },
];

interface Props {
  portfolio: PortfolioResponse | null;
  stocks?: StockPos[];
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: { color: string } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const total = d.value;
  return (
    <div className="rounded-xl px-3 py-2.5 text-xs" style={{
      background: "#15151a", border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 16px 40px rgba(0,0,0,0.8)",
    }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full" style={{ background: d.payload.color }} />
        <span style={{ color: "#909090" }}>{d.name}</span>
      </div>
      <div className="font-bold" style={{ color: "#f0f0f0" }}>
        {total >= 1_000_000 ? `$${(total / 1_000_000).toFixed(2)}M` : total >= 1_000 ? `$${(total / 1_000).toFixed(1)}K` : `$${total}`}
      </div>
    </div>
  );
}


export default function AllocationChart({ portfolio, stocks = [] }: Props) {
  const [view, setView] = useState<View>("asset");

  if (!portfolio) return null;

  let rawData: Array<{ name: string; value: number }> = [];

  if (view === "category") {
    // Krypto = all crypto tokens combined, then per stock category
    const cryptoTotal = portfolio.by_chain.reduce((s, c) => s + c.value_usd, 0);
    if (cryptoTotal > 0) rawData.push({ name: "Krypto", value: Math.round(cryptoTotal) });
    // Group stocks by category
    const catMap = new Map<string, number>();
    for (const s of stocks) {
      if ((s.value_usd ?? 0) > 0) {
        catMap.set(s.category, (catMap.get(s.category) ?? 0) + (s.value_usd ?? 0));
      }
    }
    for (const [cat, val] of catMap.entries()) {
      rawData.push({ name: cat, value: Math.round(val) });
    }
    rawData.sort((a, b) => b.value - a.value);

  } else if (view === "protocol") {
    rawData = portfolio.by_protocol.slice(0, 10).map((p) => ({ name: p.protocol, value: Math.round(p.value_usd) }));

  } else {
    // Asset view: crypto tokens + individual stocks
    rawData = portfolio.top_tokens.slice(0, 8).map((t) => ({ name: t.token_symbol, value: Math.round(t.value_usd) }));
    for (const s of stocks) {
      if ((s.value_usd ?? 0) > 0) rawData.push({ name: s.ticker, value: Math.round(s.value_usd ?? 0) });
    }
    rawData.sort((a, b) => b.value - a.value);
    rawData = rawData.slice(0, 10);
  }

  const data = rawData
    .filter((d) => d.value > 0)
    .map((d, i) => ({ ...d, color: COLORS[i % COLORS.length] }));

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="card rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Alokace</h2>
        <div className="flex gap-1 p-0.5 tab-group rounded-lg">
          {VIEWS.map(({ key, label }) => (
            <button key={key} onClick={() => setView(key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${view === key ? "tab-btn-active" : "tab-btn"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-sm" style={{ color: "#404040" }}>Žádná data</div>
      ) : (
        <div className="flex items-center gap-8">
          {/* Donut */}
          <div className="shrink-0" style={{ width: 170, height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={76}
                  paddingAngle={2} dataKey="value" strokeWidth={0}>
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legend — two columns when many items */}
          <div className={`flex-1 grid gap-x-8 gap-y-2 ${data.length > 5 ? "grid-cols-2" : "grid-cols-1"}`}>
            {data.slice(0, 10).map((d, i) => {
              const pct = total > 0 ? (d.value / total) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                    <span className="text-xs truncate" style={{ color: "#606060" }}>{d.name}</span>
                    <span className="text-[11px] font-semibold shrink-0 tabular-nums" style={{ color: "#808080" }}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
