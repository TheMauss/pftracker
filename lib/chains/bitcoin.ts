/**
 * Fetches Bitcoin balance via mempool.space public API.
 * Supports all address types: P2PKH (1...), P2SH (3...), Bech32 (bc1...), Taproot (bc1p...).
 */

import type { RawTokenBalance } from "../types";

const MEMPOOL_URL = "https://mempool.space/api";

async function fetchBtcPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://coins.llama.fi/prices/current/coingecko:bitcoin",
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      coins?: Record<string, { price?: number }>;
    };
    return data.coins?.["coingecko:bitcoin"]?.price ?? null;
  } catch {
    return null;
  }
}

export async function fetchBitcoinBalance(
  address: string
): Promise<RawTokenBalance[]> {
  try {
    const [addrRes, btcPrice] = await Promise.all([
      fetch(`${MEMPOOL_URL}/address/${address}`, {
        signal: AbortSignal.timeout(10_000),
      }),
      fetchBtcPrice(),
    ]);

    if (!addrRes.ok) {
      console.warn(`mempool.space returned ${addrRes.status} for ${address}`);
      return [];
    }

    const data = (await addrRes.json()) as {
      chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
      mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
    };

    const confirmedSats =
      data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
    const mempoolSats =
      data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
    const totalSats = confirmedSats + mempoolSats;

    if (totalSats <= 0) return [];

    const amount = totalSats / 1e8;
    const price = btcPrice ?? null;
    const value_usd = price ? amount * price : 0;

    return [
      {
        token_symbol: "BTC",
        token_name: "Bitcoin",
        chain: "bitcoin",
        amount,
        price_usd: price,
        value_usd,
        is_derivative: false,
      },
    ];
  } catch (err) {
    console.error("Bitcoin balance fetch error:", err);
    return [];
  }
}
