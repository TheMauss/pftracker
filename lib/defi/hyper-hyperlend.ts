/**
 * Fetches Hyperlend positions on HyperEVM (chain 999).
 * Hyperlend is an Aave V3 fork.
 * Uses viem multicall to batch all RPC calls into one request.
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi, defineChain } from "viem";

const HYPEREVM_RPC = "https://rpc.hyperliquid.xyz/evm";
const CHAIN_ID = 999;

const PROTOCOL_DATA_PROVIDER = "0x5481bf8d3946E6A3168640c1D7523eB59F055a29" as const;
const ORACLE_ADDRESS = "0xC9Fb4fbE842d57EAc1dF3e641a281827493A630e" as const;
const POOL_ADDRESS = "0x4B2f0a27d68B40021Cd5C6A46C82ba2c27Ed12D7" as const; // Hyperlend Pool

const DATA_PROVIDER_ABI = parseAbi([
  "function getAllReservesTokens() external view returns ((string symbol, address tokenAddress)[])",
  "function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableScalingFactor, uint256 liquidityRate, bool usageAsCollateralEnabled, bool stableBorrowRateEnabled)",
  "function getReserveData(address asset) external view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() external view returns (uint8)",
]);

const POOL_ABI = parseAbi([
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);

const ORACLE_ABI = parseAbi([
  "function getAssetPrice(address asset) external view returns (uint256)",
  "function BASE_CURRENCY_UNIT() external view returns (uint256)",
]);

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31536000n;

function rayToApy(rayRate: bigint): number {
  const ratePerSecond = Number(rayRate) / Number(RAY) / Number(SECONDS_PER_YEAR);
  return (Math.pow(1 + ratePerSecond, Number(SECONDS_PER_YEAR)) - 1) * 100;
}

const hyperevmChain = defineChain({
  id: CHAIN_ID,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPEREVM_RPC] } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

const HYPE_RATIO: Record<string, number> = {
  HYPE: 1.0,
  wstHYPE: 1.0,
  kHYPE: 1.0,
  stHYPE: 1.0,
};

async function fetchHypePrice(): Promise<number | null> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const [meta, ctxs] = (await res.json()) as [
      { universe: Array<{ name: string }> },
      Array<{ coin: string; markPx: string }>
    ];
    void meta;
    for (const ctx of ctxs) {
      if (ctx.coin === "HYPE/USDC" && ctx.markPx) return parseFloat(ctx.markPx);
    }
  } catch {}
  return null;
}

export async function fetchHyperlendPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain: hyperevmChain,
    transport: http(HYPEREVM_RPC, { timeout: 30_000, retryCount: 2, retryDelay: 1_000 }),
  });

  try {
    // Call 1: get reserves list
    const reserves = (await client.readContract({
      address: PROTOCOL_DATA_PROVIDER,
      abi: DATA_PROVIDER_ABI,
      functionName: "getAllReservesTokens",
    })) as Array<{ symbol: string; tokenAddress: string }>;

    if (reserves.length === 0) return positions;

    // Call 2: ONE multicall with all per-reserve data + baseCurrencyUnit
    type MC = { status: "success" | "failure"; result?: unknown };
    const batch = (await client.multicall({
      contracts: [
        { address: ORACLE_ADDRESS, abi: ORACLE_ABI, functionName: "BASE_CURRENCY_UNIT" },
        { address: POOL_ADDRESS, abi: POOL_ABI, functionName: "getUserAccountData" as const, args: [walletAddress as `0x${string}`] },
        ...reserves.map((r) => ({ address: PROTOCOL_DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "getUserReserveData" as const, args: [r.tokenAddress as `0x${string}`, walletAddress as `0x${string}`] })),
        ...reserves.map((r) => ({ address: PROTOCOL_DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "getReserveData" as const, args: [r.tokenAddress as `0x${string}`] })),
        ...reserves.map((r) => ({ address: r.tokenAddress as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" as const })),
        ...reserves.map((r) => ({ address: ORACLE_ADDRESS, abi: ORACLE_ABI, functionName: "getAssetPrice" as const, args: [r.tokenAddress as `0x${string}`] })),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const n = reserves.length;
    const baseCurrencyEntry = batch[0];
    const baseCurrencyUnit = (baseCurrencyEntry?.status === "success" ? baseCurrencyEntry.result : 10n ** 8n) as bigint ?? 10n ** 8n;
    const accountDataEntry = batch[1]; // getUserAccountData result
    const userDataResults   = batch.slice(2,         2 + n);
    const reserveDataResults = batch.slice(2 + n,    2 + 2 * n);
    const decimalsResults   = batch.slice(2 + 2 * n, 2 + 3 * n);
    const priceResults      = batch.slice(2 + 3 * n, 2 + 4 * n);

    // Parse health factor
    let healthFactor: number | null = null;
    let liquidationThresholdPct: number | null = null;
    if (accountDataEntry?.status === "success" && accountDataEntry.result) {
      const [, , , liqThreshRaw, , hfRaw] = accountDataEntry.result as bigint[];
      const hfNum = Number(hfRaw) / 1e18;
      healthFactor = hfNum > 1_000_000 ? null : +hfNum.toFixed(4);
      liquidationThresholdPct = Number(liqThreshRaw) / 100;
    }

    // Fetch HYPE price if needed
    const needsHype = reserves.some((r, i) => {
      const priceEntry = priceResults[i];
      const price = (priceEntry?.status === "success" ? priceEntry.result : 0n) as bigint;
      return (!price || price === 0n) && HYPE_RATIO[r.symbol] !== undefined;
    });
    const hypePrice = needsHype ? await fetchHypePrice() : null;

    for (let i = 0; i < reserves.length; i++) {
      const userEntry = userDataResults[i];
      const userData = (userEntry?.status === "success" ? userEntry.result : null) as bigint[] | null;
      if (!userData) continue;

      const [currentATokenBalance, , currentVariableDebt] = userData;
      const decimalsEntry = decimalsResults[i];
      const decimals = Number((decimalsEntry?.status === "success" ? decimalsEntry.result : 18n) as unknown as bigint);
      const divisor = 10n ** BigInt(decimals);

      const priceEntry = priceResults[i];
      const priceRaw = (priceEntry?.status === "success" ? priceEntry.result : 0n) as unknown as bigint ?? 0n;
      let priceUsd: number | null = priceRaw > 0n ? Number(priceRaw) / Number(baseCurrencyUnit) : null;
      if (!priceUsd && hypePrice && HYPE_RATIO[reserves[i].symbol] !== undefined) {
        priceUsd = hypePrice * HYPE_RATIO[reserves[i].symbol];
      }

      const reserveEntry = reserveDataResults[i];
      const reserveData = (reserveEntry?.status === "success" ? reserveEntry.result : null) as bigint[] | null;
      const liquidityRate = (reserveData?.[5] ?? 0n) as bigint;
      const variableBorrowRate = (reserveData?.[6] ?? 0n) as bigint;
      const depositApy = rayToApy(liquidityRate);
      const borrowApy = rayToApy(variableBorrowRate);

      if ((currentATokenBalance as bigint) > 0n) {
        const amount = Number(currentATokenBalance as bigint) / Number(divisor);
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol: "hyperlend",
            chain: "hyperevm",
            position_type: "lend",
            asset_symbol: reserves[i].symbol,
            asset_address: reserves[i].tokenAddress,
            amount,
            price_usd: priceUsd,
            value_usd: valueUsd,
            is_debt: false,
            apy: depositApy,
            extra_data: healthFactor !== null ? { health_factor: healthFactor, liquidation_threshold_pct: liquidationThresholdPct } : undefined,
          });
        }
      }

      if ((currentVariableDebt as bigint) > 0n) {
        const amount = Number(currentVariableDebt as bigint) / Number(divisor);
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol: "hyperlend",
            chain: "hyperevm",
            position_type: "borrow",
            asset_symbol: reserves[i].symbol,
            asset_address: reserves[i].tokenAddress,
            amount,
            price_usd: priceUsd,
            value_usd: valueUsd,
            is_debt: true,
            apy: -borrowApy,
            extra_data: healthFactor !== null ? { health_factor: healthFactor, liquidation_threshold_pct: liquidationThresholdPct } : undefined,
          });
        }
      }
    }
  } catch (err) {
    console.error("Hyperlend fetch error:", err);
  }

  return positions;
}
