/**
 * Fetches Morpho Blue positions on Ethereum and Base.
 * Uses the official Morpho GraphQL API (blue-api.morpho.org).
 * Returns supply, borrow, and collateral positions with USD values.
 */

import type { RawDefiPosition, ChainId } from "../types";

const MORPHO_GQL = "https://blue-api.morpho.org/graphql";

const QUERY = `
  query UserPositions($address: String!, $chainId: Int!) {
    userByAddress(address: $address, chainId: $chainId) {
      marketPositions {
        market {
          loanAsset      { symbol address decimals }
          collateralAsset { symbol address decimals }
          state { supplyApy borrowApy }
        }
        supplyAssets
        supplyAssetsUsd
        borrowAssets
        borrowAssetsUsd
        collateral
        collateralUsd
      }
    }
  }
`;

interface MorphoMarketPosition {
  market: {
    loanAsset:       { symbol: string; address: string; decimals: number };
    collateralAsset: { symbol: string; address: string; decimals: number } | null;
    state:           { supplyApy: number; borrowApy: number } | null;
  };
  supplyAssets:    string;
  supplyAssetsUsd: number | null;
  borrowAssets:    string;
  borrowAssetsUsd: number | null;
  collateral:      string;
  collateralUsd:   number | null;
}

const CHAIN_IDS: Partial<Record<ChainId, number>> = {
  ethereum: 1,
  base:     8453,
};

async function queryMorpho(address: string, chainId: number): Promise<MorphoMarketPosition[]> {
  const res = await fetch(MORPHO_GQL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ query: QUERY, variables: { address: address.toLowerCase(), chainId } }),
    signal:  AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Morpho API ${res.status}`);
  const json = await res.json() as { data?: { userByAddress?: { marketPositions?: MorphoMarketPosition[] } } };
  return json.data?.userByAddress?.marketPositions ?? [];
}

export async function fetchMorphoPositions(
  walletAddress: string,
  chain: ChainId
): Promise<RawDefiPosition[]> {
  const chainId = CHAIN_IDS[chain];
  if (!chainId) return [];

  const positions: RawDefiPosition[] = [];

  try {
    const mPositions = await queryMorpho(walletAddress, chainId);

    for (const pos of mPositions) {
      const supplyAssets    = BigInt(pos.supplyAssets ?? "0");
      const borrowAssets    = BigInt(pos.borrowAssets ?? "0");
      const collateralAmt   = BigInt(pos.collateral   ?? "0");

      const loanDecimals   = pos.market.loanAsset.decimals ?? 18;
      const collDecimals   = pos.market.collateralAsset?.decimals ?? 18;
      const supplyApy      = (pos.market.state?.supplyApy ?? 0) * 100;
      const borrowApy      = (pos.market.state?.borrowApy ?? 0) * 100;

      // Supply (lending in loan asset)
      if (supplyAssets > 0n) {
        const amount   = Number(supplyAssets) / 10 ** loanDecimals;
        const valueUsd = pos.supplyAssetsUsd ?? 0;
        if (valueUsd > 0.01) {
          positions.push({
            protocol:      "morpho",
            chain,
            position_type: "lend",
            asset_symbol:  pos.market.loanAsset.symbol,
            asset_address: pos.market.loanAsset.address,
            amount,
            price_usd:     amount > 0 ? valueUsd / amount : null,
            value_usd:     valueUsd,
            is_debt:       false,
            apy:           supplyApy,
          });
        }
      }

      // Borrow (in loan asset)
      if (borrowAssets > 0n) {
        const amount   = Number(borrowAssets) / 10 ** loanDecimals;
        const valueUsd = pos.borrowAssetsUsd ?? 0;
        if (valueUsd > 0.01) {
          positions.push({
            protocol:      "morpho",
            chain,
            position_type: "borrow",
            asset_symbol:  pos.market.loanAsset.symbol,
            asset_address: pos.market.loanAsset.address,
            amount,
            price_usd:     amount > 0 ? valueUsd / amount : null,
            value_usd:     valueUsd,
            is_debt:       true,
            apy:           -borrowApy,
          });
        }
      }

      // Collateral (in collateral asset)
      if (collateralAmt > 0n && pos.market.collateralAsset) {
        const amount   = Number(collateralAmt) / 10 ** collDecimals;
        const valueUsd = pos.collateralUsd ?? 0;
        if (valueUsd > 0.01) {
          positions.push({
            protocol:      "morpho",
            chain,
            position_type: "lend",
            asset_symbol:  pos.market.collateralAsset.symbol,
            asset_address: pos.market.collateralAsset.address,
            amount,
            price_usd:     amount > 0 ? valueUsd / amount : null,
            value_usd:     valueUsd,
            is_debt:       false,
            apy:           null,
          });
        }
      }
    }
  } catch (err) {
    console.error(`Morpho Blue fetch error (${chain}):`, err);
  }

  return positions;
}
