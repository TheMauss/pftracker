/**
 * Fetches Kamino lending positions (deposits + borrows) via Kamino REST API.
 * https://api.kamino.finance/
 *
 * The obligations endpoint returns raw on-chain state.
 * marketValueSf is a scaled-factor (18 decimals) representing USD value.
 * We also fetch /reserves/metrics for each market to map reserve addresses → token symbols + APYs.
 */

import type { RawDefiPosition } from "../types";

const KAMINO_API = "https://api.kamino.finance";

// Known Kamino lending markets to scan
const KAMINO_MARKETS = [
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF", // Main market
  "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek", // JLP market
  "ByYiZxp8QrdN9ocx5rvzDPGRDceL34WE4f2YsUjSpump", // Altcoin market
];

const SF_DECIMALS = 1e18; // marketValueSf scale factor

interface ReserveMetrics {
  reserve: string;
  liquidityToken: string;
  liquidityTokenMint: string;
  supplyApy: string;
  borrowApy: string;
}

interface RawDeposit {
  depositReserve: string;
  depositedAmount: string;
  marketValueSf: string;
}

interface RawBorrow {
  borrowReserve: string;
  borrowedAmountSf: string;
  marketValueSf: string;
}

interface RawObligation {
  obligationAddress: string;
  state: {
    lendingMarket: string;
    owner: string;
    deposits: RawDeposit[];
    borrows: RawBorrow[];
  };
}

async function fetchReserveMetrics(
  market: string
): Promise<Map<string, ReserveMetrics>> {
  const map = new Map<string, ReserveMetrics>();
  try {
    const res = await fetch(
      `${KAMINO_API}/kamino-market/${market}/reserves/metrics`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return map;
    const data: ReserveMetrics[] = await res.json();
    for (const r of data) {
      map.set(r.reserve, r);
    }
  } catch {
    // reserve metadata is best-effort
  }
  return map;
}

export async function fetchKaminoPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    // Query all known markets in parallel: obligations + reserves metrics
    const marketResults = await Promise.all(
      KAMINO_MARKETS.map(async (market) => {
        try {
          const [oblRes, reserveMap] = await Promise.all([
            fetch(
              `${KAMINO_API}/kamino-market/${market}/users/${walletAddress}/obligations`,
              { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }
            ),
            fetchReserveMetrics(market),
          ]);
          if (!oblRes.ok) return { obligations: [] as RawObligation[], reserveMap };
          const data = await oblRes.json();
          const obligations: RawObligation[] = Array.isArray(data) ? data : [];
          return { obligations, reserveMap };
        } catch {
          return { obligations: [] as RawObligation[], reserveMap: new Map<string, ReserveMetrics>() };
        }
      })
    );

    for (const { obligations, reserveMap } of marketResults) {
      for (const obl of obligations) {
        const state = obl.state;
        if (!state) continue;

        // Process deposits
        for (const dep of state.deposits ?? []) {
          if (dep.depositReserve === "11111111111111111111111111111111111") continue;
          const valueUsd = Number(BigInt(dep.marketValueSf)) / SF_DECIMALS;
          if (valueUsd < 0.01) continue;

          const meta = reserveMap.get(dep.depositReserve);
          positions.push({
            protocol: "kamino",
            chain: "solana",
            position_type: "lend",
            asset_symbol: meta?.liquidityToken ?? "UNKNOWN",
            asset_address: meta?.liquidityTokenMint ?? dep.depositReserve,
            amount: valueUsd, // amount in USD (raw token amount not reliably available)
            price_usd: 1.0,
            value_usd: valueUsd,
            is_debt: false,
            apy: meta?.supplyApy ? parseFloat(meta.supplyApy) * 100 : null,
            extra_data: { market: state.lendingMarket, reserve: dep.depositReserve },
          });
        }

        // Process borrows
        for (const bor of state.borrows ?? []) {
          if (bor.borrowReserve === "11111111111111111111111111111111111") continue;
          const valueUsd = Number(BigInt(bor.marketValueSf)) / SF_DECIMALS;
          if (valueUsd < 0.01) continue;

          const meta = reserveMap.get(bor.borrowReserve);
          positions.push({
            protocol: "kamino",
            chain: "solana",
            position_type: "borrow",
            asset_symbol: meta?.liquidityToken ?? "UNKNOWN",
            asset_address: meta?.liquidityTokenMint ?? bor.borrowReserve,
            amount: valueUsd,
            price_usd: 1.0,
            value_usd: valueUsd,
            is_debt: true,
            apy: meta?.borrowApy ? -(parseFloat(meta.borrowApy) * 100) : null,
            extra_data: { market: state.lendingMarket, reserve: bor.borrowReserve },
          });
        }
      }
    }
  } catch (err) {
    console.error("Kamino fetch error:", err);
  }

  // Also fetch Kamino kvaults positions
  try {
    const vaultUrl = `${KAMINO_API}/kvaults/users/${walletAddress}/positions`;
    const vaultRes = await fetch(vaultUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (vaultRes.ok) {
      const vaults = await vaultRes.json();
      if (Array.isArray(vaults)) {
        for (const vault of vaults) {
          const valueUsd = vault.balanceUSD ?? vault.sharesValueUSD ?? vault.valueUsd ?? 0;
          if (valueUsd <= 0.01) continue;
          positions.push({
            protocol: "kamino",
            chain: "solana",
            position_type: "vault",
            asset_symbol: vault.symbol ?? vault.name ?? "VAULT",
            asset_address: vault.vaultPubkey ?? vault.address ?? null,
            amount: vault.sharesAmount ?? valueUsd,
            price_usd: null,
            value_usd: valueUsd,
            is_debt: false,
            apy: vault.apy ?? null,
            extra_data: { vault: vault.vaultPubkey ?? vault.address },
          });
        }
      }
    }
  } catch {
    // vault fetch optional
  }

  return positions;
}
