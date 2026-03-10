/**
 * JLP (Jupiter Liquidity Provider) token.
 * JLP is just an SPL token — balance is picked up by the Solana chain fetcher.
 * This module enriches it with the JLP virtual price and pool APY.
 */

import type { RawDefiPosition } from "../types";

const JLP_MINT = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4";
const JUPITER_POOL_API = "https://datapi.jup.ag/v1/pool/snapshot/latest";

interface JupiterPoolSnapshot {
  poolTvl: number;
  traderPnl: number;
  lpPnl: number;
  fees: {
    totalFees1d: number;
    totalFees7d: number;
  };
  aum: number;
  price: number; // JLP virtual price in USD
}

export async function fetchJlpPosition(
  walletAddress: string,
  jlpBalance: number // balance from Solana chain fetcher
): Promise<RawDefiPosition | null> {
  if (jlpBalance <= 0) return null;

  let price = 0;
  let apy: number | null = null;

  try {
    const res = await fetch(JUPITER_POOL_API, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data: JupiterPoolSnapshot = await res.json();
      price = data.price ?? 0;
      // APY estimate from 7d fees annualized over AUM
      if (data.fees?.totalFees7d && data.aum > 0) {
        apy = (data.fees.totalFees7d / data.aum) * (365 / 7) * 100;
      }
    }
  } catch {
    // fallback to Jupiter price API
    try {
      const priceRes = await fetch(
        `https://api.jup.ag/price/v2?ids=${JLP_MINT}`
      );
      if (priceRes.ok) {
        const json = await priceRes.json();
        price = parseFloat(json?.data?.[JLP_MINT]?.price ?? "0");
      }
    } catch {
      // unknown price
    }
  }

  const valueUsd = price > 0 ? jlpBalance * price : 0;

  return {
    protocol: "jlp",
    chain: "solana",
    position_type: "lp",
    asset_symbol: "JLP",
    asset_address: JLP_MINT,
    amount: jlpBalance,
    price_usd: price > 0 ? price : null,
    value_usd: valueUsd,
    is_debt: false,
    apy,
    extra_data: { description: "Jupiter Perpetuals LP" },
  };
}

export { JLP_MINT };
