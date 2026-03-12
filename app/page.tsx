"use client";

import React, { useEffect, useState, useCallback } from "react";
import PortfolioOverview from "@/components/PortfolioOverview";
import AllocationChart from "@/components/AllocationChart";
import HistoryChart from "@/components/HistoryChart";
import AIAnalysis from "@/components/AIAnalysis";
import PerpPositions from "@/components/PerpPositions";
import BenchmarkChart from "@/components/BenchmarkChart";
import type { PortfolioResponse, SnapshotsResponse, RawTokenBalance } from "@/lib/types";
import { usePrivacy, mask } from "@/lib/privacy";
import { FxAmount, useCurrency } from "@/lib/currency";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockPos {
  id: number; source: string; ticker: string; display_name: string; category: string;
  quantity: number; price_usd: number | null; value_usd: number | null; avg_price: number | null;
}
interface StocksResponse { positions: StockPos[]; total_usd: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
  return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })}`;
}
function fmtAmount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
  if (n >= 1)         return n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
  if (n >= 0.0001)    return n.toLocaleString("cs-CZ", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return n.toExponential(2);
}
function fmtPrice(v: number) {
  if (v >= 1_000) return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
  if (v >= 1)     return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })}`;
  return `$${v.toLocaleString("cs-CZ", { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`;
}

const CHAIN_BADGE: Record<string, string> = {
  solana: "badge badge-solana", ethereum: "badge badge-ethereum",
  base: "badge badge-base", arbitrum: "badge badge-arbitrum",
  bsc: "badge badge-bsc", hyperliquid: "badge badge-hyperliquid",
  hyperevm: "badge badge-hyperevm", sui: "badge badge-sui",
};

// ─── Predict sub-components (hoisted to avoid remount-on-render UX bug) ───────

const TargetInput = function TargetInput({
  sym, value, onChange,
}: { sym: string; value: string; onChange: (sym: string, val: string) => void }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(sym, e.target.value)}
      placeholder="—"
      className="w-20 text-right tabular-nums text-xs rounded-lg px-2 py-1 outline-none"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0f0f0" }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(160,144,255,0.5)")}
      onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
    />
  );
};

function PotentialCell({ qty, currentVal, targetStr, perpPnl }: { qty: number; currentVal: number; targetStr: string; perpPnl: number }) {
  const { fxFmt } = useCurrency();
  const t = parseFloat(targetStr.replace(",", "."));
  if (!targetStr || isNaN(t)) return <span style={{ color: "#303030" }}>—</span>;
  const pred  = qty * t;
  const total = pred + perpPnl;
  const delta = total - currentVal;
  const isUp  = total >= currentVal;
  const fxTotal = fxFmt(total);
  const fxDelta = fxFmt(Math.abs(delta));
  return (
    <div className="text-right">
      <div className="font-semibold text-xs tabular-nums" style={{ color: isUp ? "#3cffa0" : "#ff3d5a" }}>
        {fmtUsd(total)}{fxTotal && <span className="ml-1 opacity-50">({fxTotal})</span>}
      </div>
      <div className="text-[10px] tabular-nums" style={{ color: isUp ? "#3cffa0" : "#ff3d5a", opacity: 0.7 }}>
        {delta >= 0 ? "+" : ""}{fmtUsd(delta)}{fxDelta && <span className="ml-1">({delta >= 0 ? "" : "−"}{fxDelta})</span>}
      </div>
    </div>
  );
}

function MultiplierCell({ qty, currentVal, targetStr }: { qty: number; currentVal: number; targetStr: string }) {
  const t = parseFloat(targetStr.replace(",", "."));
  if (!targetStr || isNaN(t) || currentVal <= 0) return <span style={{ color: "#303030" }}>—</span>;
  const mult = (qty * t) / currentVal;
  const isUp = mult >= 1;
  return (
    <span className="text-xs font-semibold tabular-nums" style={{ color: isUp ? "#3cffa0" : "#ff3d5a" }}>
      {mult >= 10 ? `${mult.toFixed(1)}×` : `${mult.toFixed(2)}×`}
    </span>
  );
}

function PerpBadge({ pnl }: { pnl: number }) {
  if (pnl === 0) return null;
  const isUp = pnl >= 0;
  return (
    <div className="text-[10px] tabular-nums mt-0.5" style={{ color: isUp ? "#3cffa0" : "#ff3d5a" }}>
      long {isUp ? "+" : ""}{fmtUsd(pnl)}
    </div>
  );
}

// ─── Combined Portfolio table ─────────────────────────────────────────────────

function PortfolioTable({
  tokens, stocks, totalUsd, perpTokens,
  predictMode, setPredictMode, targets, setTargets, setTarget,
}: {
  tokens: RawTokenBalance[];
  stocks: StockPos[];
  totalUsd: number;
  perpTokens: RawTokenBalance[];
  predictMode: boolean;
  setPredictMode: React.Dispatch<React.SetStateAction<boolean>>;
  targets: Record<string, string>;
  setTargets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setTarget: (sym: string, val: string) => void;
}) {
  const { hidden } = usePrivacy();
  const { fxFmt } = useCurrency();
  const [search, setSearch] = useState("");
  const q = search.toLowerCase();

  const filteredTokens = tokens
    .filter((t) => !t.is_derivative && t.value_usd >= 1)
    .filter((t) => !q || t.token_symbol.toLowerCase().includes(q) || (t.token_name ?? "").toLowerCase().includes(q))
    .sort((a, b) => b.value_usd - a.value_usd);

  const filteredStocks = stocks
    .filter((s) => !q || s.ticker.toLowerCase().includes(q) || s.display_name.toLowerCase().includes(q))
    .sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0));

  const stocksTotal = stocks.reduce((s, p) => s + (p.value_usd ?? 0), 0);
  const grandTotal  = totalUsd + stocksTotal;

  // Perp: group by base symbol ("BTC-PERP" → "BTC")
  const perpByBase = new Map<string, RawTokenBalance[]>();
  for (const p of perpTokens) {
    const base = p.token_symbol.replace(/-PERP$/i, "").replace(/PERP$/i, "").toUpperCase();
    const arr = perpByBase.get(base) ?? [];
    arr.push(p);
    perpByBase.set(base, arr);
  }

  // Total settlement PnL for a symbol at target price (current unrealized + incremental)
  // p.price_usd = entry price, p.value_usd = unrealized PnL
  function perpPnlFor(sym: string, targetStr: string): number {
    const t = parseFloat(targetStr.replace(",", "."));
    if (!targetStr || isNaN(t)) return 0;
    const perps = perpByBase.get(sym.toUpperCase()) ?? [];
    return perps.reduce((sum, p) => {
      if (!p.price_usd || !p.amount) return sum;
      const isShort = p.token_symbol.includes("-SHORT");
      const markPrice = isShort
        ? p.price_usd - p.value_usd / p.amount
        : p.price_usd + p.value_usd / p.amount;
      const increment = isShort ? (markPrice - t) * p.amount : (t - markPrice) * p.amount;
      return sum + p.value_usd + increment;
    }, 0);
  }

  // Total perp PnL across all predicted tokens (to add to USDC)
  const totalPerpPnl = Object.entries(targets).reduce((sum, [sym, tStr]) => {
    return sum + perpPnlFor(sym, tStr);
  }, 0);

  // Grand total in predict mode — start from grandTotal, only swap out tokens with targets
  // (avoids losing DeFi position values that aren't in filteredTokens)
  const predictedGrandTotal = predictMode ? (() => {
    let sum = grandTotal;
    const spotSymbolsAdjusted = new Set<string>();

    for (const t of filteredTokens) {
      const tStr = targets[t.token_symbol.toLowerCase()];
      const parsed = tStr ? parseFloat(tStr.replace(",", ".")) : NaN;
      if (!isNaN(parsed)) {
        const perpPnl = perpPnlFor(t.token_symbol, tStr);
        sum = sum - t.value_usd + t.amount * parsed + perpPnl;
        spotSymbolsAdjusted.add(t.token_symbol.toUpperCase());
      }
    }
    for (const s of filteredStocks) {
      const tStr = targets[s.ticker.toLowerCase()];
      const parsed = tStr ? parseFloat(tStr.replace(",", ".")) : NaN;
      if (!isNaN(parsed)) {
        sum = sum - (s.value_usd ?? 0) + s.quantity * parsed;
      }
    }
    // Perp targets set in PerpPositions for symbols without a spot token — add settlement PnL
    for (const [sym, tStr] of Object.entries(targets)) {
      if (spotSymbolsAdjusted.has(sym.toUpperCase())) continue;
      const pnl = perpPnlFor(sym, tStr);
      if (pnl !== 0) sum += pnl;
    }
    return sum;
  })() : grandTotal;

  const cols = predictMode ? 7 : 5;
  const headers = predictMode
    ? ["Název", "Počet", "Cena", "Hodnota", "Target", "Potenciál", "Δ"]
    : ["Název", "Počet", "Cena", "Hodnota", "%"];

  function SectionHeader({ label, value }: { label: string; value: number }) {
    return (
      <tr>
        <td colSpan={cols} className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#404040" }}>{label}</span>
            <span className="text-[10px] tabular-nums" style={{ color: "#303030" }}>
              {hidden ? "••••" : fmtUsd(value)}
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.04)" }} />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="card rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Portfolio</h2>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums"
            style={{ background: "rgba(255,255,255,0.06)", color: "#505050" }}>
            {filteredTokens.length + filteredStocks.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Predict toggle */}
          <button
            onClick={() => { setPredictMode((v) => !v); if (predictMode) setTargets({}); }}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
            style={{
              background: predictMode ? "rgba(160,144,255,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${predictMode ? "rgba(160,144,255,0.35)" : "rgba(255,255,255,0.07)"}`,
              color: predictMode ? "#a090ff" : "#505050",
            }}
          >
            {predictMode ? "✕ Predict" : "Predict"}
          </button>
          <div className="text-right">
            <div className="text-xs font-bold tabular-nums" style={{ color: predictMode ? "#a090ff" : "#3cffa0" }}>
              {hidden ? "••••" : fmtUsd(predictedGrandTotal)}
              {!hidden && predictMode && fxFmt(predictedGrandTotal) && (
                <span className="ml-1.5 font-normal opacity-50" style={{ fontSize: "10px" }}>({fxFmt(predictedGrandTotal)})</span>
              )}
            </div>
            {predictMode && !hidden && grandTotal > 0 && (
              <div className="text-[10px] tabular-nums" style={{ color: predictedGrandTotal >= grandTotal ? "#3cffa0" : "#ff3d5a" }}>
                {predictedGrandTotal >= grandTotal ? "+" : ""}{fmtUsd(predictedGrandTotal - grandTotal)}
              </div>
            )}
          </div>
          <input type="text" placeholder="Hledat…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field text-xs rounded-lg pl-3 pr-3 py-1.5 w-32" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {headers.map((h, i) => (
                <th key={i} className={`px-5 py-2.5 stat-label ${i >= 1 ? "text-right" : "text-left"}`}
                  style={h === "Target" || h === "Potenciál" || h === "Δ" ? { color: "#a090ff" } : {}}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* ── Krypto ── */}
            {filteredTokens.length > 0 && <SectionHeader label="Krypto" value={totalUsd} />}
            {filteredTokens.map((t, i) => {
              const pct      = grandTotal > 0 ? (t.value_usd / grandTotal) * 100 : 0;
              const tStr     = targets[t.token_symbol.toLowerCase()] ?? "";
              const perpPnl  = perpPnlFor(t.token_symbol, tStr);
              // For Hyperliquid USDC only: add total perp PnL (perps settle there)
              const isHlUsdc = /^usdc?$/i.test(t.token_symbol) && t.chain === "hyperliquid";
              const displayVal = (predictMode && isHlUsdc && totalPerpPnl !== 0)
                ? t.value_usd + totalPerpPnl
                : t.value_usd;
              const hasPerp  = (perpByBase.get(t.token_symbol.toUpperCase()) ?? []).length > 0;
              return (
                <tr key={i} className="group transition-colors duration-100"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.025)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className={CHAIN_BADGE[t.chain] ?? "badge badge-default"}>{t.chain}</span>
                      <div>
                        <div className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>{t.token_symbol}</div>
                        {t.token_name && t.token_name !== t.token_symbol && (
                          <div className="text-[10px]" style={{ color: "#404040" }}>{t.token_name}</div>
                        )}
                        {predictMode && isHlUsdc && totalPerpPnl !== 0 && (
                          <div className="text-[10px] tabular-nums" style={{ color: totalPerpPnl >= 0 ? "#3cffa0" : "#ff3d5a" }}>
                            perp {totalPerpPnl >= 0 ? "+" : ""}{fmtUsd(totalPerpPnl)}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="text-xs tabular-nums" style={{ color: "#606060" }}>
                      {mask(fmtAmount(t.amount), hidden)}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="text-xs tabular-nums" style={{ color: "#505050" }}>
                      {t.price_usd ? fmtPrice(t.price_usd) : "—"}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="text-sm font-semibold tabular-nums" style={{ color: predictMode && isHlUsdc && totalPerpPnl !== 0 ? "#a090ff" : "#f0f0f0" }}>
                      {displayVal > 0 ? mask(fmtUsd(displayVal), hidden) : "—"}
                    </span>
                    {!hidden && displayVal > 0 && <FxAmount usd={displayVal} />}
                  </td>
                  {predictMode ? (
                    <>
                      <td className="px-5 py-2.5 text-right">
                        {!isHlUsdc && <TargetInput sym={t.token_symbol} value={tStr} onChange={setTarget} />}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {!isHlUsdc
                          ? <PotentialCell qty={t.amount} currentVal={t.value_usd} targetStr={tStr} perpPnl={perpPnl} />
                          : <span style={{ color: "#404040" }}>—</span>}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {!isHlUsdc && hasPerp
                          ? <PerpBadge pnl={perpPnl} />
                          : !isHlUsdc
                            ? <MultiplierCell qty={t.amount} currentVal={t.value_usd} targetStr={tStr} />
                            : null}
                      </td>
                    </>
                  ) : (
                    <td className="px-5 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs tabular-nums" style={{ color: "#505050" }}>
                          {pct >= 0.1 ? pct.toFixed(1) : "<0.1"}%
                        </span>
                        <div className="h-[2px] rounded-full" style={{ width: 36, background: "rgba(255,255,255,0.05)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(pct * 2.5, 100)}%`, background: "#3cffa0" }} />
                        </div>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}

            {/* ── Non-crypto grouped by category ── */}
            {(() => {
              const categories = [...new Set(filteredStocks.map((s) => s.category))].sort();
              return categories.map((cat) => {
                const catStocks = filteredStocks.filter((s) => s.category === cat);
                const catTotal  = catStocks.reduce((s, p) => s + (p.value_usd ?? 0), 0);
                return (
                  <React.Fragment key={cat}>
                    <SectionHeader label={cat} value={catTotal} />
                    {catStocks.map((s) => {
                      const pct  = grandTotal > 0 ? ((s.value_usd ?? 0) / grandTotal) * 100 : 0;
                      const cv   = s.value_usd ?? 0;
                      const tStr = targets[s.ticker.toLowerCase()] ?? "";
                      return (
                        <tr key={s.id} className="group transition-colors duration-100"
                          style={{ borderBottom: "1px solid rgba(255,255,255,0.025)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <span className="badge" style={{ background: "rgba(255,179,64,0.1)", color: "#ffb340", border: "1px solid rgba(255,179,64,0.2)" }}>
                                {cat.toLowerCase()}
                              </span>
                              <div>
                                <div className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>{s.ticker}</div>
                                {s.display_name !== s.ticker && (
                                  <div className="text-[10px] truncate max-w-[140px]" style={{ color: "#404040" }}>{s.display_name}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <span className="text-xs tabular-nums" style={{ color: "#606060" }}>
                              {mask(fmtAmount(s.quantity), hidden)}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <span className="text-xs tabular-nums" style={{ color: "#505050" }}>
                              {s.price_usd != null ? fmtPrice(s.price_usd) : "—"}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <span className="text-sm font-semibold tabular-nums" style={{ color: "#f0f0f0" }}>
                              {cv > 0 ? mask(fmtUsd(cv), hidden) : "—"}
                            </span>
                            {!hidden && cv > 0 && <FxAmount usd={cv} />}
                          </td>
                          {predictMode ? (
                            <>
                              <td className="px-5 py-2.5 text-right">
                                <TargetInput sym={s.ticker} value={tStr} onChange={setTarget} />
                              </td>
                              <td className="px-5 py-2.5 text-right">
                                <PotentialCell qty={s.quantity} currentVal={cv} targetStr={tStr} perpPnl={0} />
                              </td>
                              <td className="px-5 py-2.5 text-right">
                                <MultiplierCell qty={s.quantity} currentVal={cv} targetStr={tStr} />
                              </td>
                            </>
                          ) : (
                            <td className="px-5 py-2.5 text-right">
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-xs tabular-nums" style={{ color: "#505050" }}>
                                  {pct >= 0.1 ? pct.toFixed(1) : "<0.1"}%
                                </span>
                                <div className="h-[2px] rounded-full" style={{ width: 36, background: "rgba(255,255,255,0.05)" }}>
                                  <div className="h-full rounded-full" style={{ width: `${Math.min(pct * 2.5, 100)}%`, background: "#ffb340" }} />
                                </div>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              });
            })()}

            {filteredTokens.length === 0 && filteredStocks.length === 0 && (
              <tr><td colSpan={cols} className="text-center py-14 text-xs" style={{ color: "#404040" }}>
                {search ? "Žádné výsledky" : "Žádné pozice"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [history, setHistory]     = useState<SnapshotsResponse | null>(null);
  const [stocks, setStocks]       = useState<StocksResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [chartRange, setChartRange]   = useState<"7d" | "30d" | "90d" | "ytd" | "1y" | "all">("30d");

  // Predict state — shared between PortfolioTable and PerpPositions
  const [predictMode, setPredictMode] = useState(false);
  const [targets, setTargets]         = useState<Record<string, string>>({});
  const setTarget = useCallback((sym: string, val: string) => {
    setTargets((prev) => ({ ...prev, [sym.toLowerCase()]: val }));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [portRes, histRes, stocksRes] = await Promise.all([
        fetch("/api/portfolio"),
        fetch("/api/snapshots?from=" + new Date(Date.now() - 90 * 86400000).toISOString()),
        fetch("/api/stocks"),
      ]);
      if (portRes.ok)   setPortfolio(await portRes.json());
      if (histRes.ok)   setHistory(await histRes.json());
      if (stocksRes.ok) setStocks(await stocksRes.json());
      setLastUpdated(new Date().toLocaleTimeString("cs-CZ"));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Perp positions (is_derivative=true, amount>0)
  const perpTokens: RawTokenBalance[] = portfolio?.wallets
    .flatMap((w) => w.tokens)
    .filter((t) => t.is_derivative && t.amount > 0) ?? [];

  // Merge tokens from all wallets
  const mergedTokens: RawTokenBalance[] = (() => {
    const raw = portfolio?.wallets.flatMap((w) => w.tokens).filter((t) => !t.is_derivative && t.value_usd >= 1) ?? [];
    const map = new Map<string, RawTokenBalance>();
    for (const t of raw) {
      // Include token_name in key when no address — keeps e.g. HL "Perp Equity" USDC separate from spot USDC
      const key = t.token_address
        ? `${t.token_address.toLowerCase()}:${t.chain}`
        : `${t.token_symbol.toLowerCase()}:${t.chain}:${t.token_name ?? ""}`;
      const ex = map.get(key);
      if (ex) { ex.amount += t.amount; ex.value_usd += t.value_usd; }
      else map.set(key, { ...t });
    }
    return [...map.values()];
  })();

  const unknownCount = portfolio?.unknown_price_count ?? 0;
  const stockList    = stocks?.positions ?? [];

  // Merge stocks into portfolio total for the overview cards
  const combinedPortfolio = portfolio
    ? { ...portfolio, total_usd: portfolio.total_usd + (stocks?.total_usd ?? 0) }
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "#f0f0f0" }}>Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color: "#404040" }}>
            {lastUpdated ? `Aktualizováno ${lastUpdated}` : "Načítám…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={async () => {
            const secret = prompt("Zadej SNAPSHOT_SECRET:");
            if (!secret) return;
            const res = await fetch("/api/snapshot", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-snapshot-secret": secret },
              body: JSON.stringify({}),
            });
            const result = await res.json();
            if (res.ok) { alert(`Snapshot vytvořen! $${result.totalUsd?.toFixed(2)}`); fetchData(); }
            else alert(`Chyba: ${result.error}`);
          }} className="btn-primary text-xs px-3.5 py-2 rounded-xl">
            + Snapshot
          </button>
          <button onClick={fetchData} disabled={loading}
            className="btn-ghost text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5">
            <span className={loading ? "animate-spin" : ""}>↻</span>
            {loading ? "Načítám" : "Obnovit"}
          </button>
        </div>
      </div>

      {unknownCount > 0 && (
        <div className="text-xs rounded-xl px-4 py-3 flex items-center gap-2"
          style={{ background: "rgba(255,112,64,0.07)", border: "1px solid rgba(255,112,64,0.18)", color: "#ff9a60" }}>
          <span>⚠</span>
          <span>{unknownCount} tokenů s neznámou cenou je vyloučeno z celkové hodnoty.</span>
        </div>
      )}

      {/* Stat cards */}
      <PortfolioOverview portfolio={combinedPortfolio} history={history} loading={loading} />

      {/* Charts — value (left) + performance % (right), shared range selector */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HistoryChart data={history} forceMode="value" range={chartRange} onRangeChange={setChartRange} />
        <HistoryChart data={history} forceMode="performance" range={chartRange} onRangeChange={setChartRange} />
      </div>

      {/* Allocation + Benchmark side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AllocationChart portfolio={portfolio} stocks={stockList} />
        <BenchmarkChart />
      </div>

      {/* Open perp positions — only rendered when positions exist */}
      <PerpPositions
        tokens={perpTokens}
        predictMode={predictMode}
        targets={targets}
        setTarget={setTarget}
      />

      {/* Portfolio holdings */}
      <PortfolioTable
        tokens={mergedTokens}
        stocks={stockList}
        totalUsd={portfolio?.total_usd ?? 0}
        perpTokens={perpTokens}
        predictMode={predictMode}
        setPredictMode={setPredictMode}
        targets={targets}
        setTargets={setTargets}
        setTarget={setTarget}
      />

      {/* AI Analysis */}
      <AIAnalysis />
    </div>
  );
}
