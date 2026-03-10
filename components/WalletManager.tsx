"use client";

import { useState } from "react";
import type { Wallet } from "@/lib/types";

const CHAINS = [
  { value: "solana", label: "Solana" },
  { value: "evm", label: "EVM (Ethereum / Base / Arbitrum / BSC / Hyperliquid)" },
] as const;

interface Props {
  wallets: Wallet[];
  onRefresh: () => void;
}

export default function WalletManager({ wallets, onRefresh }: Props) {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<"solana" | "evm">("solana");
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
        body: JSON.stringify({ address: address.trim(), chain, label: label.trim() || undefined, }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Chyba");
        return;
      }
      setAddress("");
      setLabel("");
      onRefresh();
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
      {/* Add wallet form */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <h2 className="font-semibold text-white mb-4">Přidat peněženku</h2>
        <div className="flex flex-wrap gap-2">
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value as "solana" | "evm")}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            {CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Adresa peněženky"
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
          />

          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Název (volitelné)"
            className="w-36 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />

          <button
            onClick={addWallet}
            disabled={loading || !address.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded font-medium transition-colors"
          >
            {loading ? "Přidávám..." : "Přidat"}
          </button>
        </div>

        {error && (
          <div className="mt-2 text-red-400 text-sm">{error}</div>
        )}
      </div>

      {/* Wallet list */}
      <div className="bg-gray-900 rounded-xl border border-gray-800">
        <div className="p-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">
            Peněženky ({wallets.length})
          </h2>
        </div>
        {wallets.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            Žádné peněženky. Přidej svou první výše.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-800">
                <th className="text-left px-4 py-2">Název</th>
                <th className="text-left px-4 py-2">Chain</th>
                <th className="text-left px-4 py-2">Adresa</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {wallets.map((w) => (
                <tr
                  key={w.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                >
                  <td className="px-4 py-2.5 text-white">
                    {w.label ?? `Peněženka ${w.id}`}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{w.chain}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-400 text-xs">
                    {w.address.slice(0, 12)}...{w.address.slice(-6)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => deleteWallet(w.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors text-xs"
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
