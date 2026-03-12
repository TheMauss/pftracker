/**
 * Fetches Aerodrome Finance LP positions on Base.
 * Aerodrome uses a Uniswap V3-style NonfungiblePositionManager (Slipstream)
 * at 0x827922686190790b37229fd06084350E74485b72 on Base.
 *
 * We enumerate the user's LP NFTs via tokenOfOwnerByIndex and fetch
 * each position's token amounts via the Aerodrome Slipstream Sugar contract
 * or directly from the pool.
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { getCoinGeckoPrices } from "../prices";

// Aerodrome Slipstream (CLMM) NonfungiblePositionManager on Base
const NFPM_ADDRESS = "0x827922686190790b37229fd06084350E74485b72" as const;

// Aerodrome Sugar contract for easy position data (alternative helper)
// Fallback: use NFPM directly
const NFPM_ABI = parseAbi([
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
]);

const ERC20_ABI = parseAbi([
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
]);

const POOL_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address pool)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool feeProtocol, bool unlocked)",
]);

// Aerodrome factory for CLMM pools
const FACTORY_ADDRESS = "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A" as const;
const FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address)",
]);

function alchemyBaseUrl(): string {
  const key = process.env.ALCHEMY_API_KEY ?? "";
  return `https://base-mainnet.g.alchemy.com/v2/${key}`;
}

/**
 * Compute token amounts from Uniswap V3-style CLMM position.
 * Returns { amount0, amount1 } in raw token units (before decimals division).
 */
function getAmountsFromLiquidity(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number
): { amount0: bigint; amount1: bigint } {
  const Q96 = 2n ** 96n;

  function tickToSqrtPrice(tick: number): bigint {
    // sqrt(1.0001^tick) * Q96
    const ratio = Math.pow(1.0001, tick);
    return BigInt(Math.floor(Math.sqrt(ratio) * Number(Q96)));
  }

  const sqrtLower = tickToSqrtPrice(tickLower);
  const sqrtUpper = tickToSqrtPrice(tickUpper);
  const sqrtCurrent = sqrtPriceX96;

  let amount0 = 0n;
  let amount1 = 0n;

  if (liquidity === 0n) return { amount0, amount1 };

  if (sqrtCurrent <= sqrtLower) {
    // All in token0
    amount0 = (liquidity * Q96 * (sqrtUpper - sqrtLower)) / (sqrtLower * sqrtUpper);
  } else if (sqrtCurrent >= sqrtUpper) {
    // All in token1
    amount1 = (liquidity * (sqrtUpper - sqrtLower)) / Q96;
  } else {
    // Mixed
    amount0 = (liquidity * Q96 * (sqrtUpper - sqrtCurrent)) / (sqrtCurrent * sqrtUpper);
    amount1 = (liquidity * (sqrtCurrent - sqrtLower)) / Q96;
  }

  return { amount0, amount1 };
}

export async function fetchAerodromePositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    const client = createPublicClient({
      chain: base,
      transport: http(alchemyBaseUrl()),
    });

    const addr = walletAddress as `0x${string}`;

    // 1. Get number of LP NFTs owned
    const nftBalance = (await client.readContract({
      address: NFPM_ADDRESS,
      abi: NFPM_ABI,
      functionName: "balanceOf",
      args: [addr],
    })) as bigint;

    if (nftBalance === 0n) return positions;

    const count = Number(nftBalance);
    // Cap at 50 NFTs to avoid excessive RPC calls
    const tokenIds = await Promise.all(
      Array.from({ length: Math.min(count, 50) }, (_, i) =>
        client.readContract({
          address: NFPM_ADDRESS,
          abi: NFPM_ABI,
          functionName: "tokenOfOwnerByIndex",
          args: [addr, BigInt(i)],
        }) as Promise<bigint>
      )
    );

    // 2. Fetch position data for all token IDs in parallel
    type PosResult = [bigint, string, string, string, number, number, number, bigint, bigint, bigint, bigint, bigint];
    const posDataResults = await Promise.allSettled(
      tokenIds.map((id) =>
        client.readContract({
          address: NFPM_ADDRESS,
          abi: NFPM_ABI,
          functionName: "positions",
          args: [id],
        }) as Promise<PosResult>
      )
    );

    // Collect unique token addresses for metadata + prices
    const tokenAddrs = new Set<string>();
    const validPositions: { tokenId: bigint; pos: PosResult }[] = [];

    for (let i = 0; i < posDataResults.length; i++) {
      const r = posDataResults[i];
      if (r.status !== "fulfilled") continue;
      const pos = r.value;
      const liquidity = pos[7];
      if (liquidity === 0n) continue; // closed position
      validPositions.push({ tokenId: tokenIds[i], pos });
      tokenAddrs.add(pos[2].toLowerCase()); // token0
      tokenAddrs.add(pos[3].toLowerCase()); // token1
    }

    if (validPositions.length === 0) return positions;

    // 3. Fetch token metadata (symbol, decimals) + prices
    const addrArr = Array.from(tokenAddrs);
    type MC = { status: "success" | "failure"; result?: unknown };

    const metaBatch = (await client.multicall({
      contracts: [
        ...addrArr.map((a) => ({ address: a as `0x${string}`, abi: ERC20_ABI, functionName: "symbol" as const })),
        ...addrArr.map((a) => ({ address: a as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" as const })),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const symbolMap = new Map<string, string>();
    const decimalsMap = new Map<string, number>();
    const n = addrArr.length;
    for (let i = 0; i < n; i++) {
      const sym = metaBatch[i];
      const dec = metaBatch[i + n];
      if (sym?.status === "success") symbolMap.set(addrArr[i], sym.result as string);
      if (dec?.status === "success") decimalsMap.set(addrArr[i], Number(dec.result as bigint));
    }

    const prices = await getCoinGeckoPrices(addrArr, "base");

    // 4. Fetch pool sqrtPrice for each unique (token0, token1, tickSpacing) combo
    const poolPriceCache = new Map<string, bigint>();
    const poolFetches = validPositions.map(async ({ pos }) => {
      const token0 = pos[2].toLowerCase();
      const token1 = pos[3].toLowerCase();
      const tickSpacing = pos[4];
      const cacheKey = `${token0}:${token1}:${tickSpacing}`;
      if (poolPriceCache.has(cacheKey)) return;
      try {
        const poolAddr = (await client.readContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "getPool",
          args: [pos[2], pos[3], tickSpacing],
        })) as `0x${string}`;
        if (!poolAddr || poolAddr === "0x0000000000000000000000000000000000000000") return;
        const slot0 = (await client.readContract({
          address: poolAddr,
          abi: POOL_ABI,
          functionName: "slot0",
        })) as [bigint, ...unknown[]];
        poolPriceCache.set(cacheKey, slot0[0]);
      } catch {}
    });
    await Promise.allSettled(poolFetches);

    // 5. Calculate position values
    for (const { tokenId, pos } of validPositions) {
      const token0 = pos[2].toLowerCase();
      const token1 = pos[3].toLowerCase();
      const tickSpacing = pos[4];
      const tickLower = pos[5];
      const tickUpper = pos[6];
      const liquidity = pos[7];

      const cacheKey = `${token0}:${token1}:${tickSpacing}`;
      const sqrtPriceX96 = poolPriceCache.get(cacheKey);
      if (!sqrtPriceX96) continue;

      const decimals0 = decimalsMap.get(token0) ?? 18;
      const decimals1 = decimalsMap.get(token1) ?? 18;
      const symbol0 = symbolMap.get(token0) ?? "?";
      const symbol1 = symbolMap.get(token1) ?? "?";
      const price0 = prices.get(token0) ?? null;
      const price1 = prices.get(token1) ?? null;

      const { amount0, amount1 } = getAmountsFromLiquidity(
        liquidity, sqrtPriceX96, tickLower, tickUpper
      );

      const amt0 = Number(amount0) / Math.pow(10, decimals0);
      const amt1 = Number(amount1) / Math.pow(10, decimals1);

      // Include uncollected fees
      const fee0 = Number(pos[10]) / Math.pow(10, decimals0);
      const fee1 = Number(pos[11]) / Math.pow(10, decimals1);

      const totalAmt0 = amt0 + fee0;
      const totalAmt1 = amt1 + fee1;

      const usd0 = price0 ? totalAmt0 * price0 : 0;
      const usd1 = price1 ? totalAmt1 * price1 : 0;
      const totalUsd = usd0 + usd1;

      if (totalUsd < 0.01) continue;

      positions.push({
        protocol: "aerodrome" as never, // aerodrome not in ProtocolId yet
        chain: "base",
        position_type: "lp",
        asset_symbol: `${symbol0}-${symbol1}`,
        asset_address: tokenId.toString(),
        amount: totalUsd,
        price_usd: 1.0,
        value_usd: totalUsd,
        is_debt: false,
        apy: null,
        extra_data: {
          tokenId: tokenId.toString(),
          token0: { symbol: symbol0, amount: totalAmt0, usd: usd0 },
          token1: { symbol: symbol1, amount: totalAmt1, usd: usd1 },
          tickLower,
          tickUpper,
        },
      });
    }
  } catch (err) {
    console.error("Aerodrome fetch error:", err);
  }

  return positions;
}
