"use client";

import { useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { PortfolioResponse } from "@/lib/types";

const COLORS = [
  "#6366f1",
  "#22d3ee",
  "#f59e0b",
  "#10b981",
  "#f43f5e",
  "#a855f7",
  "#3b82f6",
  "#84cc16",
  "#ec4899",
  "#14b8a6",
];

function fmt(v: number) {
  return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
}

interface Props {
  portfolio: PortfolioResponse | null;
}

type View = "chain" | "protocol" | "token";

export default function AllocationChart({ portfolio }: Props) {
  const [view, setView] = useState<View>("chain");

  if (!portfolio) return null;

  let data: Array<{ name: string; value: number }> = [];

  if (view === "chain") {
    data = portfolio.by_chain.map((c) => ({
      name: c.chain,
      value: Math.round(c.value_usd * 100) / 100,
    }));
  } else if (view === "protocol") {
    data = portfolio.by_protocol.slice(0, 10).map((p) => ({
      name: `${p.protocol} (${p.chain})`,
      value: Math.round(p.value_usd * 100) / 100,
    }));
  } else {
    data = portfolio.top_tokens.slice(0, 10).map((t) => ({
      name: `${t.token_symbol} (${t.chain})`,
      value: Math.round(t.value_usd * 100) / 100,
    }));
  }

  data = data.filter((d) => d.value > 0);

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-white">Alokace portfolia</h2>
        <div className="flex gap-1 text-xs">
          {(["chain", "protocol", "token"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 rounded transition-colors ${
                view === v
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:bg-gray-800"
              }`}
            >
              {v === "chain" ? "Chain" : v === "protocol" ? "Protokol" : "Token"}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
          Žádná data
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => [fmt(Number(value)), "Hodnota"]}
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f3f4f6",
              }}
            />
            <Legend
              formatter={(value) => (
                <span className="text-xs text-gray-300">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
