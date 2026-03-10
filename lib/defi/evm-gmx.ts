/**
 * Fetches GMX V2 positions on Arbitrum.
 * GMX V2 uses GM tokens (market tokens) for liquidity.
 */

import type { RawDefiPosition } from "../types";

const GMX_API = "https://arbitrum-api.gmxinfra.io";
const GMX_API2 = "https://api.gmx.io/v2";

interface GmxMarket {
  marketTokenAddress: string;
  indexTokenAddress: string;
  longTokenAddress: string;
  shortTokenAddress: string;
  marketSymbol: string;
  gmPrice: number;
  totalSupply: string;
  poolValueUsd: number;
  apy: number;
}

interface GmxMarketTokenBalance {
  market: string;
  balance: string;
  valueUsd: number;
}

export async function fetchGmxPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    // Fetch GM token balances via GMX stats API
    const url = `${GMX_API}/accounts/${walletAddress}/gm_tokens`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });

    if (res.ok) {
      const data = await res.json();
      const balances: GmxMarketTokenBalance[] = data?.gmTokens ?? data ?? [];

      for (const bal of balances) {
        const valueUsd = bal.valueUsd ?? 0;
        if (valueUsd <= 0.01) continue;

        positions.push({
          protocol: "gmx",
          chain: "arbitrum",
          position_type: "lp",
          asset_symbol: `GM-${bal.market ?? "MARKET"}`,
          asset_address: bal.market ?? null,
          amount: valueUsd,
          price_usd: 1.0,
          value_usd: valueUsd,
          is_debt: false,
          apy: null,
          extra_data: {
            gmTokenBalance: bal.balance,
            marketAddress: bal.market,
          },
        });
      }
      return positions;
    }
  } catch {
    // fallback to markets approach
  }

  // Fallback: fetch all GMX V2 markets and check GM token balances
  try {
    const marketsRes = await fetch(`${GMX_API}/markets`, {
      headers: { Accept: "application/json" },
    });
    if (!marketsRes.ok) return positions;

    const marketsData = await marketsRes.json();
    const markets: GmxMarket[] = marketsData?.markets ?? [];

    if (markets.length === 0) return positions;

    // Check ERC20 balance for each GM token (limit to top 20 by TVL)
    const topMarkets = markets
      .sort((a, b) => b.poolValueUsd - a.poolValueUsd)
      .slice(0, 20);

    const { createPublicClient, http, parseAbi } = await import("viem");
    const { arbitrum } = await import("viem/chains");

    const client = createPublicClient({
      chain: arbitrum,
      transport: http(),
    });

    const ERC20_ABI = parseAbi([
      "function balanceOf(address account) external view returns (uint256)",
      "function totalSupply() external view returns (uint256)",
      "function decimals() external view returns (uint8)",
    ]);

    const balanceChecks = await Promise.all(
      topMarkets.map((m) =>
        client
          .readContract({
            address: m.marketTokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [walletAddress as `0x${string}`],
          })
          .catch(() => 0n)
      )
    );

    for (let i = 0; i < topMarkets.length; i++) {
      const market = topMarkets[i];
      const balance = balanceChecks[i] as bigint;
      if (balance === 0n) continue;

      const totalSupply = BigInt(market.totalSupply ?? "0");
      if (totalSupply === 0n) continue;

      const fraction = Number(balance) / Number(totalSupply);
      const valueUsd = fraction * market.poolValueUsd;
      if (valueUsd < 0.01) continue;

      positions.push({
        protocol: "gmx",
        chain: "arbitrum",
        position_type: "lp",
        asset_symbol: market.marketSymbol ?? "GM",
        asset_address: market.marketTokenAddress,
        amount: Number(balance) / 1e18,
        price_usd: market.gmPrice ?? null,
        value_usd: valueUsd,
        is_debt: false,
        apy: market.apy ?? null,
        extra_data: {
          marketAddress: market.marketTokenAddress,
          indexToken: market.indexTokenAddress,
        },
      });
    }
  } catch (err) {
    console.error("GMX fetch error:", err);
  }

  return positions;
}
