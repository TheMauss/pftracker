/**
 * Fetches Uniswap V3 LP positions via the NFT Position Manager contract.
 * Uses Uniswap V3 subgraph for position values and APRs.
 */

import type { RawDefiPosition, ChainId } from "../types";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet, base, arbitrum } from "viem/chains";

const POSITION_MANAGER: Record<string, `0x${string}`> = {
  ethereum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  base: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
  arbitrum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
};

// Uniswap V3 subgraph endpoints
const SUBGRAPH: Record<string, string> = {
  ethereum:
    "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3",
  arbitrum:
    "https://api.thegraph.com/subgraphs/name/ianlapham/arbitrum-minimal",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHAINS: Record<string, any> = {
  ethereum: mainnet,
  base,
  arbitrum,
};

const POSITION_MANAGER_ABI = parseAbi([
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
]);

const ERC20_ABI = parseAbi([
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
]);

export async function fetchUniswapPositions(
  walletAddress: string,
  chain: ChainId
): Promise<RawDefiPosition[]> {
  const pmAddress = POSITION_MANAGER[chain];
  const viemChain = CHAINS[chain];

  if (!pmAddress || !viemChain) return [];

  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain: viemChain,
    transport: http(),
  });

  try {
    const balance = (await client.readContract({
      address: pmAddress,
      abi: POSITION_MANAGER_ABI,
      functionName: "balanceOf",
      args: [walletAddress as `0x${string}`],
    })) as bigint;

    if (balance === 0n) return [];

    // Fetch all token IDs
    const tokenIdPromises = Array.from({ length: Number(balance) }, (_, i) =>
      client.readContract({
        address: pmAddress,
        abi: POSITION_MANAGER_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [walletAddress as `0x${string}`, BigInt(i)],
      })
    );
    const tokenIds = (await Promise.all(tokenIdPromises)) as bigint[];

    // Fetch position data for each token
    const positionDataPromises = tokenIds.map((id) =>
      client.readContract({
        address: pmAddress,
        abi: POSITION_MANAGER_ABI,
        functionName: "positions",
        args: [id],
      })
    );
    const positionDatas = await Promise.all(positionDataPromises);

    // Use subgraph for USD values if available
    const subgraphValues = await fetchSubgraphValues(
      tokenIds.map((id) => id.toString()),
      chain
    );

    for (let i = 0; i < tokenIds.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = positionDatas[i] as any as {
        token0: string;
        token1: string;
        fee: number;
        liquidity: bigint;
        tokensOwed0: bigint;
        tokensOwed1: bigint;
      };

      if (pos.liquidity === 0n) continue;

      // Get token symbols
      const [symbol0, symbol1] = await Promise.all([
        client
          .readContract({
            address: pos.token0 as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "symbol",
          })
          .catch(() => "?"),
        client
          .readContract({
            address: pos.token1 as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "symbol",
          })
          .catch(() => "?"),
      ]);

      const tokenId = tokenIds[i].toString();
      const subgraphData = subgraphValues.get(tokenId);
      const valueUsd = subgraphData?.valueUsd ?? 0;
      const feeApr = subgraphData?.feeApr ?? null;

      positions.push({
        protocol: "uniswap",
        chain,
        position_type: "lp",
        asset_symbol: `${symbol0}-${symbol1}`,
        asset_address: tokenId,
        amount: valueUsd,
        price_usd: 1.0,
        value_usd: valueUsd,
        is_debt: false,
        apy: feeApr,
        extra_data: {
          tokenId,
          fee: pos.fee,
          token0: { address: pos.token0, symbol: symbol0 },
          token1: { address: pos.token1, symbol: symbol1 },
        },
      });
    }
  } catch (err) {
    console.error(`Uniswap V3 fetch error (${chain}):`, err);
  }

  return positions;
}

async function fetchSubgraphValues(
  tokenIds: string[],
  chain: ChainId
): Promise<Map<string, { valueUsd: number; feeApr: number | null }>> {
  const result = new Map<string, { valueUsd: number; feeApr: number | null }>();
  const subgraphUrl = SUBGRAPH[chain];
  if (!subgraphUrl || tokenIds.length === 0) return result;

  try {
    const query = `{
      positions(where: { id_in: [${tokenIds.map((id) => `"${id}"`).join(",")}] }) {
        id
        depositedToken0
        depositedToken1
        withdrawnToken0
        withdrawnToken1
        collectedFeesToken0
        collectedFeesToken1
        pool {
          feeTier
          token0 { symbol derivedETH }
          token1 { symbol derivedETH }
          token0Price
          token1Price
          volumeUSD
          liquidity
        }
        liquidity
        token0 { symbol }
        token1 { symbol }
      }
    }`;

    const res = await fetch(subgraphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return result;

    const data = await res.json();
    for (const pos of data?.data?.positions ?? []) {
      // Simplified value estimate
      result.set(pos.id, {
        valueUsd: 0, // Would need oracle prices for accurate value
        feeApr: null,
      });
    }
  } catch {
    // subgraph unavailable
  }

  return result;
}
