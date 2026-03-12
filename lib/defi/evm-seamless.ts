/**
 * Fetches Seamless Protocol positions on Base.
 * Seamless is an Aave V3 fork — the second-largest lending protocol on Base.
 * Uses viem multicall with the same approach as evm-spark.ts.
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

// Seamless Protocol on Base
const POOL_ADDRESSES_PROVIDER = "0x0E02EB705be325407707662C6f6d3466E939f3a0" as const;
const POOL_DATA_PROVIDER      = "0x43Df9c0a1156c96cEa98737b511ac89D0e2A1F46" as const;

const ADDRESSES_PROVIDER_ABI = parseAbi([
  "function getPriceOracle() external view returns (address)",
]);

const DATA_PROVIDER_ABI = parseAbi([
  "function getAllReservesTokens() external view returns ((string symbol, address tokenAddress)[])",
  "function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableScalingFactor, uint256 liquidityRate, bool usageAsCollateralEnabled, bool stableBorrowRateEnabled)",
  "function getReserveData(address asset) external view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);

const ORACLE_ABI = parseAbi([
  "function getAssetPrice(address asset) external view returns (uint256)",
  "function BASE_CURRENCY_UNIT() external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() external view returns (uint8)",
]);

const RAY             = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000n;

function rayToApy(rayRate: bigint): number {
  const ratePerSecond = Number(rayRate) / Number(RAY) / Number(SECONDS_PER_YEAR);
  return (Math.pow(1 + ratePerSecond, Number(SECONDS_PER_YEAR)) - 1) * 100;
}

function alchemyRpc(): string {
  const key = process.env.ALCHEMY_API_KEY ?? "";
  return `https://base-mainnet.g.alchemy.com/v2/${key}`;
}

export async function fetchSeamlessPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain:     base,
    transport: http(alchemyRpc()),
  });

  try {
    // Step 1: get oracle address dynamically
    const oracleAddr = (await client.readContract({
      address:      POOL_ADDRESSES_PROVIDER,
      abi:          ADDRESSES_PROVIDER_ABI,
      functionName: "getPriceOracle",
    })) as `0x${string}`;

    // Step 2: reserves list
    const reserves = (await client.readContract({
      address:      POOL_DATA_PROVIDER,
      abi:          DATA_PROVIDER_ABI,
      functionName: "getAllReservesTokens",
    })) as Array<{ symbol: string; tokenAddress: string }>;

    if (reserves.length === 0) return positions;

    // Step 3: base currency unit
    let baseCurrencyUnit = 10n ** 8n;
    try {
      baseCurrencyUnit = (await client.readContract({
        address:      oracleAddr,
        abi:          ORACLE_ABI,
        functionName: "BASE_CURRENCY_UNIT",
      })) as bigint;
    } catch { /* use default 1e8 */ }

    // Step 4: ONE multicall for all per-reserve data
    type MC = { status: "success" | "failure"; result?: unknown };
    const batch = (await client.multicall({
      contracts: [
        ...reserves.map(r => ({ address: POOL_DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "getUserReserveData" as const, args: [r.tokenAddress as `0x${string}`, walletAddress as `0x${string}`] })),
        ...reserves.map(r => ({ address: POOL_DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "getReserveData"     as const, args: [r.tokenAddress as `0x${string}`] })),
        ...reserves.map(r => ({ address: r.tokenAddress as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" as const })),
        ...reserves.map(r => ({ address: oracleAddr, abi: ORACLE_ABI, functionName: "getAssetPrice" as const, args: [r.tokenAddress as `0x${string}`] })),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const n              = reserves.length;
    const userDataR      = batch.slice(0,     n);
    const reserveDataR   = batch.slice(n,   2*n);
    const decimalsR      = batch.slice(2*n, 3*n);
    const priceR         = batch.slice(3*n, 4*n);

    for (let i = 0; i < n; i++) {
      const userData = (userDataR[i]?.status === "success" ? userDataR[i].result : null) as bigint[] | null;
      if (!userData) continue;

      const [currentATokenBalance, , currentVariableDebt] = userData;
      const decimals  = Number((decimalsR[i]?.status === "success" ? decimalsR[i].result : 18n) as unknown as bigint);
      const divisor   = 10n ** BigInt(decimals);
      const priceRaw  = (priceR[i]?.status === "success" ? priceR[i].result : 0n) as unknown as bigint ?? 0n;
      const priceUsd  = priceRaw > 0n ? Number(priceRaw) / Number(baseCurrencyUnit) : null;

      const reserveData     = (reserveDataR[i]?.status === "success" ? reserveDataR[i].result : null) as bigint[] | null;
      const liquidityRate   = (reserveData?.[5] ?? 0n) as bigint;
      const variableBorRate = (reserveData?.[6] ?? 0n) as bigint;
      const depositApy      = rayToApy(liquidityRate);
      const borrowApy       = rayToApy(variableBorRate);

      if ((currentATokenBalance as bigint) > 0n) {
        const amount   = Number(currentATokenBalance as bigint) / Number(divisor);
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol:      "seamless",
            chain:         "base",
            position_type: "lend",
            asset_symbol:  reserves[i].symbol,
            asset_address: reserves[i].tokenAddress,
            amount,
            price_usd:     priceUsd,
            value_usd:     valueUsd,
            is_debt:       false,
            apy:           depositApy,
          });
        }
      }

      if ((currentVariableDebt as bigint) > 0n) {
        const amount   = Number(currentVariableDebt as bigint) / Number(divisor);
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol:      "seamless",
            chain:         "base",
            position_type: "borrow",
            asset_symbol:  reserves[i].symbol,
            asset_address: reserves[i].tokenAddress,
            amount,
            price_usd:     priceUsd,
            value_usd:     valueUsd,
            is_debt:       true,
            apy:           -borrowApy,
          });
        }
      }
    }
  } catch (err) {
    console.error("Seamless Protocol fetch error:", err);
  }

  return positions;
}
