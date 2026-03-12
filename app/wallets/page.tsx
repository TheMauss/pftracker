"use client";

import { useEffect, useState, useCallback } from "react";
import WalletManager from "@/components/WalletManager";
import type { Wallet } from "@/lib/types";

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);

  const fetchWallets = useCallback(async () => {
    const res = await fetch("/api/wallets");
    if (res.ok) setWallets(await res.json());
  }, []);

  useEffect(() => { fetchWallets(); }, [fetchWallets]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight" style={{ color: "#f0f0f0" }}>Peněženky</h1>
        <p className="text-xs mt-0.5" style={{ color: "#404040" }}>{wallets.length} peněženek sledováno</p>
      </div>
      <WalletManager wallets={wallets} onRefresh={fetchWallets} />
    </div>
  );
}
