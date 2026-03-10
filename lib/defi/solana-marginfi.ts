/**
 * Fetches MarginFi lending/borrowing positions.
 * Uses the MarginFi REST API (no wallet signing needed for reads).
 */

import type { RawDefiPosition } from "../types";

const MRGN_API = "https://marginfi.com/api/v2";

interface MarginfiAccountResponse {
  publicKey: string;
  group: string;
  balances: Array<{
    bankAddress: string;
    assetShares: string;
    liabilityShares: string;
    bankData: {
      tokenSymbol: string;
      tokenMint: string;
      depositApy: number;
      borrowApy: number;
      tokenPrice: number;
      totalDeposits: number;
      totalBorrows: number;
    };
    assetValueUSD: number;
    liabilityValueUSD: number;
  }>;
  totalAssetsUSD: number;
  totalLiabilitiesUSD: number;
  healthFactor: number;
}

export async function fetchMarginFiPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    const url = `${MRGN_API}/account/${walletAddress}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });

    if (!res.ok) {
      // Try alternate endpoint format
      return await fetchMarginFiV2(walletAddress);
    }

    const accounts: MarginfiAccountResponse[] = await res.json();
    const accountList = Array.isArray(accounts) ? accounts : [accounts];

    for (const account of accountList) {
      if (!account?.balances) continue;

      for (const bal of account.balances) {
        const bank = bal.bankData;
        if (!bank) continue;

        // Deposits
        if (bal.assetValueUSD > 0.01) {
          const amount =
            parseFloat(bal.assetShares) /
            Math.pow(10, 9); // approximate, shares
          positions.push({
            protocol: "marginfi",
            chain: "solana",
            position_type: "lend",
            asset_symbol: bank.tokenSymbol ?? "UNKNOWN",
            asset_address: bank.tokenMint ?? null,
            amount,
            price_usd: bank.tokenPrice ?? null,
            value_usd: bal.assetValueUSD,
            is_debt: false,
            apy: bank.depositApy ?? null,
            extra_data: {
              healthFactor: account.healthFactor,
              group: account.group,
            },
          });
        }

        // Borrows
        if (bal.liabilityValueUSD > 0.01) {
          const amount = parseFloat(bal.liabilityShares) / Math.pow(10, 9);
          positions.push({
            protocol: "marginfi",
            chain: "solana",
            position_type: "borrow",
            asset_symbol: bank.tokenSymbol ?? "UNKNOWN",
            asset_address: bank.tokenMint ?? null,
            amount,
            price_usd: bank.tokenPrice ?? null,
            value_usd: bal.liabilityValueUSD,
            is_debt: true,
            apy: -(bank.borrowApy ?? 0),
            extra_data: {
              healthFactor: account.healthFactor,
              group: account.group,
            },
          });
        }
      }
    }
  } catch (err) {
    console.error("MarginFi fetch error:", err);
  }

  return positions;
}

async function fetchMarginFiV2(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  // Alternate: query marginfi accounts by authority
  try {
    const url = `https://api.marginfi.com/accounts?authority=${walletAddress}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    // Parse similar structure
    return parseMarginFiV2Response(data);
  } catch {
    return [];
  }
}

function parseMarginFiV2Response(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
): RawDefiPosition[] {
  const positions: RawDefiPosition[] = [];
  const accounts = Array.isArray(data) ? data : data?.accounts ?? [];

  for (const account of accounts) {
    for (const bal of account?.lendingAccount?.balances ?? []) {
      const assetShares = parseFloat(bal.assetShares?.value ?? "0");
      const liabilityShares = parseFloat(bal.liabilityShares?.value ?? "0");
      const bankMeta = bal.bankAddress;

      if (assetShares > 0) {
        positions.push({
          protocol: "marginfi",
          chain: "solana",
          position_type: "lend",
          asset_symbol: bankMeta ?? "UNKNOWN",
          amount: assetShares,
          value_usd: 0, // price unknown from this endpoint
          is_debt: false,
          apy: null,
        });
      }

      if (liabilityShares > 0) {
        positions.push({
          protocol: "marginfi",
          chain: "solana",
          position_type: "borrow",
          asset_symbol: bankMeta ?? "UNKNOWN",
          amount: liabilityShares,
          value_usd: 0,
          is_debt: true,
          apy: null,
        });
      }
    }
  }

  return positions;
}
