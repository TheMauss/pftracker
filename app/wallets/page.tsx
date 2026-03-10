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
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-white">Peněženky</h1>
      <WalletManager wallets={wallets} onRefresh={fetchWallets} />
    </div>
  );
}
