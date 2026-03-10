"use client";

import type { PortfolioResponse, SnapshotsResponse } from "@/lib/types";

interface Props {
  portfolio: PortfolioResponse | null;
  history: SnapshotsResponse | null;
  loading: boolean;
}

function fmt(v: number) {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

function pnlClass(v: number | null) {
  if (v === null) return "text-gray-500";
  return v >= 0 ? "text-green-400" : "text-red-400";
}

function pnlSign(v: number | null) {
  if (v === null) return "—";
  return (v >= 0 ? "+" : "") + fmt(v);
}

export default function PortfolioOverview({ portfolio, history, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-gray-900 rounded-xl p-5 animate-pulse h-24" />
        ))}
      </div>
    );
  }

  const total = portfolio?.total_usd ?? 0;
  const deposited = portfolio?.defi_deposit_usd ?? 0;
  const borrowed = portfolio?.defi_borrow_usd ?? 0;
  const ltv = deposited > 0 ? ((borrowed / deposited) * 100).toFixed(1) : "0";

  const pnl = history?.pnl;

  const cards = [
    {
      label: "Celková hodnota",
      value: fmt(total),
      sub: pnl?.total_1d !== null ? `24h: ${pnlSign(pnl?.total_1d ?? null)}` : null,
      subClass: pnlClass(pnl?.total_1d ?? null),
    },
    {
      label: "DeFi depositováno",
      value: fmt(deposited),
      sub: `Půjčeno: ${fmt(borrowed)}`,
      subClass: "text-gray-400",
    },
    {
      label: "Celkové LTV",
      value: `${ltv}%`,
      sub: borrowed > 0 ? (parseFloat(ltv) > 70 ? "⚠ Vysoké LTV" : "✓ OK") : "Žádné dluhy",
      subClass: parseFloat(ltv) > 70 ? "text-orange-400" : "text-green-400",
    },
    {
      label: "7d PnL",
      value: pnlSign(pnl?.total_7d ?? null),
      valueClass: pnlClass(pnl?.total_7d ?? null),
      sub: pnl?.total_30d !== null ? `30d: ${pnlSign(pnl?.total_30d ?? null)}` : null,
      subClass: pnlClass(pnl?.total_30d ?? null),
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-gray-900 rounded-xl p-5 border border-gray-800"
        >
          <div className="text-xs text-gray-500 mb-1">{card.label}</div>
          <div
            className={`text-2xl font-bold tabular-nums ${card.valueClass ?? "text-white"}`}
          >
            {card.value}
          </div>
          {card.sub && (
            <div className={`text-xs mt-1 ${card.subClass}`}>{card.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}
