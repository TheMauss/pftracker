"use client";

import type { RawTokenBalance } from "@/lib/types";
import { usePrivacy, mask } from "@/lib/privacy";
import { FxAmount, useCurrency } from "@/lib/currency";

function fmtUsd(v: number) {
  const abs = Math.abs(v);
  const s = abs >= 1_000 ? `$${(abs / 1_000).toFixed(1)}K` : `$${abs.toFixed(2)}`;
  return v < 0 ? `−${s}` : `+${s}`;
}
function fmtPrice(v: number) {
  if (v >= 10_000) return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}`;
  if (v >= 1)      return `$${v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })}`;
  return `$${v.toLocaleString("cs-CZ", { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`;
}
function fmtAmt(n: number) {
  if (n >= 1_000) return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
  if (n >= 1)     return n.toLocaleString("cs-CZ", { maximumFractionDigits: 3 });
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

interface Props {
  tokens: RawTokenBalance[];
  predictMode?: boolean;
  targets?: Record<string, string>;
  setTarget?: (sym: string, val: string) => void;
}

export default function PerpPositions({ tokens, predictMode = false, targets = {}, setTarget }: Props) {
  const { hidden } = usePrivacy();
  const { fxFmt } = useCurrency();

  const perps = tokens.filter((t) => t.is_derivative && t.amount > 0);
  if (perps.length === 0) return null;

  const headers = predictMode
    ? ["Kontrakt", "Směr / Páka", "Velikost", "Mark cena", "Target", "Pred. PnL"]
    : ["Kontrakt", "Směr / Páka", "Velikost", "Entry cena", "Unreal. PnL"];

  return (
    <div className="card rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>Otevřené perp pozice</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {headers.map((h, i) => (
                <th key={h} className={`px-5 py-2.5 stat-label ${i === 0 ? "text-left" : "text-right"}`}
                  style={h === "Target" || h === "Pred. PnL" ? { color: "#a090ff" } : {}}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perps.map((t, i) => {
              const isShort = t.token_symbol.includes("-SHORT");
              const coin = t.token_symbol.replace("-PERP-SHORT", "").replace("-PERP", "");
              const levMatch = t.token_name?.match(/x(\d+)/);
              const lev = levMatch ? levMatch[1] : null;

              // t.price_usd = entry price (from Hyperliquid entryPx)
              // t.value_usd = unrealized PnL
              // Mark price derived: long → entry + pnl/size, short → entry - pnl/size
              const markPrice = t.price_usd != null && t.amount > 0
                ? isShort
                  ? t.price_usd - t.value_usd / t.amount
                  : t.price_usd + t.value_usd / t.amount
                : null;

              // Base symbol for target lookup (matches PortfolioTable key)
              const base = coin.toLowerCase();
              const tStr = targets[base] ?? "";
              const targetVal = parseFloat(tStr.replace(",", "."));
              const hasTarget = tStr !== "" && !isNaN(targetVal) && markPrice != null;

              // Predicted PnL = current unrealized + (target - mark) * size
              // null = no target set in predict mode → show "—"
              const predictedPnl = hasTarget
                ? t.value_usd + (isShort ? (markPrice! - targetVal) : (targetVal - markPrice!)) * t.amount
                : null;

              const displayPnl = predictMode ? predictedPnl : t.value_usd;
              const pnlColor = (displayPnl ?? 0) > 0 ? "#3cffa0" : (displayPnl ?? 0) < 0 ? "#ff3d5a" : "#606060";

              return (
                <tr key={i}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.025)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>

                  {/* Contract */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="badge badge-hyperliquid">{t.chain}</span>
                      <span className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>{coin}</span>
                    </div>
                  </td>

                  {/* Direction + leverage */}
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md"
                        style={{
                          background: isShort ? "rgba(255,61,90,0.1)" : "rgba(60,255,160,0.1)",
                          border: `1px solid ${isShort ? "rgba(255,61,90,0.2)" : "rgba(60,255,160,0.2)"}`,
                          color: isShort ? "#ff3d5a" : "#3cffa0",
                        }}>
                        {isShort ? "Short" : "Long"}
                      </span>
                      {lev && (
                        <span className="text-xs tabular-nums" style={{ color: "#505050" }}>x{lev}</span>
                      )}
                    </div>
                  </td>

                  {/* Size */}
                  <td className="px-5 py-3 text-right">
                    <span className="text-xs tabular-nums" style={{ color: "#606060" }}>
                      {mask(fmtAmt(t.amount), hidden)} {coin}
                    </span>
                  </td>

                  {/* Mark price (predict mode) or Entry price (normal mode) */}
                  <td className="px-5 py-3 text-right">
                    <span className="text-xs tabular-nums" style={{ color: "#505050" }}>
                      {predictMode
                        ? (markPrice != null ? fmtPrice(markPrice) : "—")
                        : (t.price_usd != null ? fmtPrice(t.price_usd) : "—")}
                    </span>
                  </td>

                  {/* Target input (predict mode only) */}
                  {predictMode && (
                    <td className="px-5 py-3 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={tStr}
                        onChange={(e) => setTarget?.(coin, e.target.value)}
                        placeholder="—"
                        className="w-20 text-right tabular-nums text-xs rounded-lg px-2 py-1 outline-none"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0f0f0" }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(160,144,255,0.5)")}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
                      />
                    </td>
                  )}

                  {/* PnL column */}
                  <td className="px-5 py-3 text-right">
                    {displayPnl !== null ? (
                      <>
                        <span className="text-sm font-semibold tabular-nums" style={{ color: pnlColor }}>
                          {mask(fmtUsd(displayPnl), hidden)}
                          {!hidden && predictMode && fxFmt(Math.abs(displayPnl)) && (
                            <span className="ml-1 font-normal opacity-50 text-[10px]">({fxFmt(Math.abs(displayPnl))})</span>
                          )}
                        </span>
                        {!hidden && !predictMode && <FxAmount usd={Math.abs(displayPnl)} className="text-[10px] tabular-nums mt-0.5" />}
                      </>
                    ) : (
                      <span style={{ color: "#303030" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
