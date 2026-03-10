"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { format, subDays } from "date-fns";
import type { SnapshotsResponse } from "@/lib/types";

type Range = "7d" | "30d" | "90d" | "all";

const WALLET_COLORS = [
  "#6366f1",
  "#22d3ee",
  "#f59e0b",
  "#10b981",
  "#f43f5e",
  "#a855f7",
];

interface Props {
  data: SnapshotsResponse | null;
}

function fmtK(v: number) {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export default function HistoryChart({ data }: Props) {
  const [range, setRange] = useState<Range>("30d");

  if (!data?.history?.length) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <h2 className="font-semibold text-white mb-4">Historie portfolia</h2>
        <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
          Žádná historická data — první snapshot se vytvoří o půlnoci.
          <br />
          Lze spustit manuálně přes API: POST /api/snapshot
        </div>
      </div>
    );
  }

  // Filter by range
  const cutoff =
    range === "all"
      ? null
      : subDays(
          new Date(),
          range === "7d" ? 7 : range === "30d" ? 30 : 90
        );

  const filtered = data.history.filter(
    (h) => !cutoff || new Date(h.taken_at) >= cutoff
  );

  // Add daily PnL delta
  const chartData = filtered.map((h, i) => {
    const prev = filtered[i - 1];
    const delta = prev ? h.total_usd - prev.total_usd : 0;
    return {
      date: format(new Date(h.taken_at), "d.M"),
      total: Math.round(h.total_usd),
      delta: Math.round(delta),
    };
  });

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-white">Historie portfolia</h2>
        <div className="flex gap-1 text-xs">
          {(["7d", "30d", "90d", "all"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 rounded transition-colors ${
                range === r
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:bg-gray-800"
              }`}
            >
              {r === "all" ? "Vše" : r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            tickLine={false}
          />
          <YAxis
            yAxisId="total"
            tickFormatter={fmtK}
            tick={{ fontSize: 11, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="delta"
            orientation="right"
            tickFormatter={fmtK}
            tick={{ fontSize: 11, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "8px",
              color: "#f3f4f6",
              fontSize: 12,
            }}
            formatter={(value, name) => {
              const n = Number(value);
              return [
                name === "total"
                  ? `$${n.toLocaleString("cs-CZ")}`
                  : (n >= 0 ? "+" : "") + `$${Math.abs(n).toLocaleString("cs-CZ")}`,
                name === "total" ? "Hodnota" : "Denní změna",
              ];
            }}
          />
          <Legend
            formatter={(value) => (
              <span className="text-xs text-gray-400">
                {value === "total" ? "Hodnota" : "Denní změna"}
              </span>
            )}
          />
          <Area
            yAxisId="total"
            type="monotone"
            dataKey="total"
            stroke="#6366f1"
            fill="#6366f1"
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
          />
          <Bar
            yAxisId="delta"
            dataKey="delta"
            fill="#22d3ee"
            opacity={0.6}
            radius={[2, 2, 0, 0]}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
