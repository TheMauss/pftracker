"use client";

import { useState } from "react";
import type { Wallet } from "@/lib/types";

const CHAINS = [
  { value: "solana",  label: "Solana" },
  { value: "evm",     label: "EVM (Ethereum / Base / Arbitrum / BSC / Hyperliquid)" },
  { value: "sui",     label: "Sui" },
  { value: "bitcoin", label: "Bitcoin" },
] as const;

const CHAIN_COLOR: Record<string, string> = {
  solana:      "#9945ff",
  evm:         "#627eea",
  ethereum:    "#627eea",
  base:        "#0052ff",
  arbitrum:    "#12aaff",
  bsc:         "#f3ba2f",
  hyperliquid: "#3cffa0",
  hyperevm:    "#3cffa0",
  sui:         "#4da2ff",
  bitcoin:     "#f7931a",
};

interface Props { wallets: Wallet[]; onRefresh: () => void; }

export default function WalletManager({ wallets, onRefresh }: Props) {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<"solana" | "evm" | "sui" | "bitcoin">("solana");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function addWallet() {
    if (!address.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim(), chain, label: label.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Chyba"); return; }
      setAddress(""); setLabel(""); onRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function deleteWallet(id: number) {
    if (!confirm("Smazat peněženku? Historie zůstane zachována.")) return;
    await fetch(`/api/wallets?id=${id}`, { method: "DELETE" });
    onRefresh();
  }

  return (
    <div className="space-y-4">
      {/* Add wallet */}
      <div className="card rounded-2xl p-5">
        <h2 className="text-sm font-semibold mb-4" style={{ color: "#f0f0f0" }}>Přidat peněženku</h2>
        <div className="flex flex-wrap gap-2">
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value as "solana" | "evm" | "sui" | "bitcoin")}
            className="input-field rounded-xl px-3 py-2.5 text-sm"
            style={{ background: "#080808" }}
          >
            {CHAINS.map((c) => (
              <option key={c.value} value={c.value} style={{ background: "#101013" }}>
                {c.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Adresa peněženky"
            className="input-field flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm font-mono"
          />

          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Název (volitelné)"
            className="input-field w-36 rounded-xl px-3 py-2.5 text-sm"
          />

          <button
            onClick={addWallet}
            disabled={loading || !address.trim()}
            className="btn-primary px-5 py-2.5 text-sm rounded-xl"
          >
            {loading ? "Přidávám…" : "Přidat"}
          </button>
        </div>

        {error && (
          <div
            className="mt-3 text-sm rounded-xl px-3.5 py-2.5"
            style={{ color: "#ff3d5a", background: "rgba(255,61,90,0.08)", border: "1px solid rgba(255,61,90,0.2)" }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Wallet list */}
      <div className="card rounded-2xl overflow-hidden">
        <div
          className="px-5 py-3.5 flex items-center justify-between"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "#f0f0f0" }}>
            Peněženky <span className="font-normal" style={{ color: "#404040" }}>({wallets.length})</span>
          </h2>
        </div>
        {wallets.length === 0 ? (
          <div className="p-12 text-center text-xs" style={{ color: "#303030" }}>
            Žádné peněženky. Přidej svou první výše.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {["Název", "Chain", "Adresa", ""].map((h, i) => (
                  <th key={i} className="px-5 py-2.5 stat-label text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wallets.map((w) => (
                <tr
                  key={w.id}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <td className="px-5 py-3.5 font-medium" style={{ color: "#f0f0f0" }}>
                    {w.label ?? `Peněženka ${w.id}`}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className="text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
                      style={{
                        color: CHAIN_COLOR[w.chain] ?? "#606060",
                        background: `${CHAIN_COLOR[w.chain] ?? "#606060"}15`,
                      }}
                    >
                      {w.chain}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 font-mono" style={{ color: "#404040" }}>
                    {w.address.slice(0, 12)}…{w.address.slice(-6)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => deleteWallet(w.id)}
                      className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                      style={{ color: "#404040" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color = "#ff3d5a";
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,61,90,0.08)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color = "#404040";
                        (e.currentTarget as HTMLButtonElement).style.background = "";
                      }}
                    >
                      Smazat
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
