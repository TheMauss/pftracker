/**
 * Fetches Orca Whirlpool LP positions.
 * 1. Uses Helius DAS `getAssetsByOwner` to find Orca position NFTs
 *    (filtered by update_authority = Orca Whirlpool NFT update authority).
 * 2. For each position mint, fetches position data from the Orca mainnet API.
 */

import type { RawDefiPosition } from "../types";

// Orca Whirlpool NFT update authority (used to identify Orca position NFTs)
const ORCA_NFT_UPDATE_AUTHORITY = "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr";
const ORCA_API = "https://api.mainnet.orca.so";

function heliusUrl(): string {
  const val = process.env.HELIUS_API_KEY ?? "";
  const match = val.match(/api-key=([a-f0-9-]{36})/);
  const key = match ? match[1] : val;
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

interface HeliusAsset {
  id: string;
  authorities?: Array<{ address: string }>;
  content?: { metadata?: { name?: string } };
}

interface OrcaPositionResponse {
  positionMint: string;
  whirlpool?: string;
  liquidity?: string;
  tokenA?: { mint: string; symbol: string; amount: number; usdValue: number };
  tokenB?: { mint: string; symbol: string; amount: number; usdValue: number };
  totalUsdValue?: number;
  feeApr?: number;
  rewardApr?: number;
  totalApr?: number;
  isInRange?: boolean;
}

export async function fetchOrcaPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    // Step 1: Find Orca position NFTs via Helius DAS
    const dasRes = await fetch(heliusUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAssetsByOwner",
        params: {
          ownerAddress: walletAddress,
          page: 1,
          limit: 1000,
          displayOptions: { showFungible: false, showNativeBalance: false },
        },
      }),
    });

    if (!dasRes.ok) return positions;
    const dasJson = await dasRes.json();
    const assets: HeliusAsset[] = dasJson?.result?.items ?? [];

    // Filter for Orca position NFTs by update_authority
    const orcaMints = assets
      .filter((a) =>
        a.authorities?.some((auth) => auth.address === ORCA_NFT_UPDATE_AUTHORITY)
      )
      .map((a) => a.id);

    if (orcaMints.length === 0) return positions;

    // Step 2: Fetch position data from Orca API for each mint
    const positionResults = await Promise.allSettled(
      orcaMints.map((mint) =>
        fetch(`${ORCA_API}/v1/position/${mint}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        }).then((r) => (r.ok ? r.json() as Promise<OrcaPositionResponse> : null))
      )
    );

    for (const result of positionResults) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const pos = result.value;
      const totalUsd = pos.totalUsdValue ?? 0;
      if (totalUsd <= 0.01) continue;

      const symbolA = pos.tokenA?.symbol ?? "?";
      const symbolB = pos.tokenB?.symbol ?? "?";

      positions.push({
        protocol: "orca",
        chain: "solana",
        position_type: "lp",
        asset_symbol: `${symbolA}-${symbolB}`,
        asset_address: pos.positionMint,
        amount: totalUsd,
        price_usd: 1.0,
        value_usd: totalUsd,
        is_debt: false,
        apy: pos.totalApr ?? pos.feeApr ?? null,
        extra_data: {
          whirlpool: pos.whirlpool,
          isInRange: pos.isInRange,
          tokenA: { symbol: symbolA, amount: pos.tokenA?.amount, usd: pos.tokenA?.usdValue },
          tokenB: { symbol: symbolB, amount: pos.tokenB?.amount, usd: pos.tokenB?.usdValue },
          feeApr: pos.feeApr,
          rewardApr: pos.rewardApr,
        },
      });
    }
  } catch (err) {
    console.error("Orca fetch error:", err);
  }

  return positions;
}
