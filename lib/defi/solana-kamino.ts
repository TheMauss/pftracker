/**
 * Fetches Kamino lending positions (deposits + borrows) via Kamino REST API.
 * https://api.kamino.finance/
 */

import type { RawDefiPosition } from "../types";

const KAMINO_API = "https://api.kamino.finance";

interface KaminoObligation {
  address: string;
  lendingMarket: string;
  deposits: Array<{
    mintAddress: string;
    symbol: string;
    amount: number;
    amountUSD: number;
    apy: number;
  }>;
  borrows: Array<{
    mintAddress: string;
    symbol: string;
    amount: number;
    amountUSD: number;
    apy: number;
  }>;
}

export async function fetchKaminoPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    const url = `${KAMINO_API}/v2/users/${walletAddress}/obligations`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];

    const obligations: KaminoObligation[] = await res.json();
    if (!Array.isArray(obligations)) return [];

    for (const obl of obligations) {
      for (const dep of obl.deposits ?? []) {
        if (!dep.amountUSD || dep.amountUSD <= 0.01) continue;
        positions.push({
          protocol: "kamino",
          chain: "solana",
          position_type: "lend",
          asset_symbol: dep.symbol ?? "UNKNOWN",
          asset_address: dep.mintAddress,
          amount: dep.amount ?? 0,
          price_usd: dep.amount > 0 ? dep.amountUSD / dep.amount : null,
          value_usd: dep.amountUSD,
          is_debt: false,
          apy: dep.apy ?? null,
          extra_data: { market: obl.lendingMarket },
        });
      }

      for (const bor of obl.borrows ?? []) {
        if (!bor.amountUSD || bor.amountUSD <= 0.01) continue;
        positions.push({
          protocol: "kamino",
          chain: "solana",
          position_type: "borrow",
          asset_symbol: bor.symbol ?? "UNKNOWN",
          asset_address: bor.mintAddress,
          amount: bor.amount ?? 0,
          price_usd: bor.amount > 0 ? bor.amountUSD / bor.amount : null,
          value_usd: bor.amountUSD,
          is_debt: true,
          apy: bor.apy ?? null,
          extra_data: { market: obl.lendingMarket },
        });
      }
    }
  } catch (err) {
    console.error("Kamino fetch error:", err);
  }

  // Also fetch Kamino vaults (liquidity strategies)
  try {
    const vaultUrl = `${KAMINO_API}/v2/users/${walletAddress}/strategies`;
    const vaultRes = await fetch(vaultUrl, {
      headers: { Accept: "application/json" },
    });
    if (vaultRes.ok) {
      const vaults = await vaultRes.json();
      if (Array.isArray(vaults)) {
        for (const vault of vaults) {
          const valueUsd = vault.balanceUSD ?? vault.sharesValueUSD ?? 0;
          if (valueUsd <= 0.01) continue;
          positions.push({
            protocol: "kamino",
            chain: "solana",
            position_type: "vault",
            asset_symbol: vault.strategy?.tokenA?.symbol
              ? `${vault.strategy.tokenA.symbol}/${vault.strategy.tokenB?.symbol ?? ""}`
              : "VAULT",
            asset_address: vault.strategy?.address ?? null,
            amount: vault.sharesAmount ?? 0,
            price_usd: null,
            value_usd: valueUsd,
            is_debt: false,
            apy: vault.apy ?? vault.strategy?.apy ?? null,
            extra_data: { strategy: vault.strategy?.address },
          });
        }
      }
    }
  } catch {
    // vault fetch optional
  }

  return positions;
}
