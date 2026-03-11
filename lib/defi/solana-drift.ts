/**
 * Fetches Drift Protocol positions via the Drift Data API.
 * https://data.api.drift.trade/playground
 *
 * Step 1: GET /authority/{wallet}/accounts → list of account IDs
 * Step 2: GET /authority/{wallet}/snapshots/overview → current positions overview
 */

import type { RawDefiPosition } from "../types";

const DRIFT_API = "https://data.api.drift.trade";

interface DriftAccount {
  accountId: string;
  subAccountId: number;
  name: string;
}

interface DriftTradeProduct {
  marketIndex: number;
  marketSymbol: string;
  direction: string; // "long" | "short"
  notional: number;
  entryPrice: number;
  oraclePrice: number;
  pnl: number;
  fundingAllTime: number;
  baseAssetAmount: number;
}

interface DriftEarnProduct {
  marketIndex: number;
  marketSymbol: string;
  currentDeposit: number;
  currentBorrow: number;
  depositApy: number;
  borrowApy: number;
  netApy: number;
  netUsdValue: number;
}

interface DriftOverview {
  success: boolean;
  products: {
    trade: DriftTradeProduct[];
    earn: DriftEarnProduct[];
    vaults: Array<{
      vaultName: string;
      vaultAddress: string;
      equity: number;
      pnl: number;
    }>;
  };
}

export async function fetchDriftPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    // Step 1: Check if wallet has any Drift accounts
    const accountsRes = await fetch(
      `${DRIFT_API}/authority/${walletAddress}/accounts`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }
    );
    if (!accountsRes.ok) return positions;

    const accountsData = await accountsRes.json();
    const accounts: DriftAccount[] = accountsData?.accounts ?? [];
    if (accounts.length === 0) return positions;

    // Step 2: Get overview snapshot (covers all sub-accounts)
    const overviewRes = await fetch(
      `${DRIFT_API}/authority/${walletAddress}/snapshots/overview`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }
    );
    if (!overviewRes.ok) return positions;

    const overview: DriftOverview = await overviewRes.json();
    if (!overview.success) return positions;

    // Earn products (spot deposits/borrows)
    for (const earn of overview.products.earn ?? []) {
      if (earn.currentDeposit > 0.01) {
        positions.push({
          protocol: "drift",
          chain: "solana",
          position_type: "lend",
          asset_symbol: earn.marketSymbol ?? `SPOT-${earn.marketIndex}`,
          amount: earn.currentDeposit,
          price_usd: earn.netUsdValue > 0 && earn.currentDeposit > 0
            ? earn.netUsdValue / earn.currentDeposit
            : null,
          value_usd: Math.abs(earn.netUsdValue),
          is_debt: false,
          apy: earn.depositApy ?? null,
        });
      }

      if (earn.currentBorrow > 0.01) {
        positions.push({
          protocol: "drift",
          chain: "solana",
          position_type: "borrow",
          asset_symbol: earn.marketSymbol ?? `SPOT-${earn.marketIndex}`,
          amount: earn.currentBorrow,
          price_usd: null,
          value_usd: Math.abs(earn.netUsdValue),
          is_debt: true,
          apy: earn.borrowApy ? -earn.borrowApy : null,
        });
      }
    }

    // Trade products (perp positions)
    for (const trade of overview.products.trade ?? []) {
      const notional = Math.abs(trade.notional ?? 0);
      if (notional <= 0.01) continue;

      positions.push({
        protocol: "drift",
        chain: "solana",
        position_type: "perp",
        asset_symbol: `${trade.marketSymbol}-PERP`,
        amount: Math.abs(trade.baseAssetAmount ?? 0),
        price_usd: trade.oraclePrice ?? null,
        value_usd: trade.pnl ?? 0,
        is_debt: false,
        apy: null,
        extra_data: {
          side: trade.direction,
          notional,
          entryPrice: trade.entryPrice,
          pnl: trade.pnl,
          fundingAllTime: trade.fundingAllTime,
        },
      });
    }

    // Vault positions
    for (const vault of overview.products.vaults ?? []) {
      if (Math.abs(vault.equity ?? 0) <= 0.01) continue;
      positions.push({
        protocol: "drift",
        chain: "solana",
        position_type: "vault",
        asset_symbol: vault.vaultName ?? "DRIFT-VAULT",
        amount: vault.equity,
        price_usd: 1.0,
        value_usd: vault.equity,
        is_debt: false,
        apy: null,
        extra_data: { vaultAddress: vault.vaultAddress, pnl: vault.pnl },
      });
    }
  } catch (err) {
    console.error("Drift fetch error:", err);
  }

  return positions;
}
