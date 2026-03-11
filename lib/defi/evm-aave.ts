/**
 * Fetches Aave V3 positions on Ethereum, Base, and Arbitrum.
 * Uses viem to read from Aave's PoolDataProvider contract.
 */

import type { RawDefiPosition, ChainId } from "../types";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet, base, arbitrum } from "viem/chains";

const AAVE_DATA_PROVIDERS: Record<string, `0x${string}`> = {
  ethereum: "0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3",
  base: "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A",
  arbitrum: "0x6b4E260b765B3cA1514e618C0215A6B7839fF93e",
};

const AAVE_ORACLES: Record<string, `0x${string}`> = {
  ethereum: "0x54586bE62E3c3580375aE3723C145253060Ca0C2",
  base: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
  arbitrum: "0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHAINS: Record<string, any> = {
  ethereum: mainnet,
  base,
  arbitrum,
};

function alchemyRpc(chain: string): string {
  const key = process.env.ALCHEMY_API_KEY ?? "";
  const prefix: Record<string, string> = {
    ethereum: "eth-mainnet",
    base: "base-mainnet",
    arbitrum: "arb-mainnet",
  };
  return `https://${prefix[chain]}.g.alchemy.com/v2/${key}`;
}

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

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31536000n;

function rayToApy(rayRate: bigint): number {
  const ratePerSecond = Number(rayRate) / Number(RAY) / Number(SECONDS_PER_YEAR);
  return (Math.pow(1 + ratePerSecond, Number(SECONDS_PER_YEAR)) - 1) * 100;
}

export async function fetchAavePositions(
  walletAddress: string,
  chain: ChainId
): Promise<RawDefiPosition[]> {
  const dataProvider = AAVE_DATA_PROVIDERS[chain];
  const oracleAddr = AAVE_ORACLES[chain];
  const viemChain = CHAINS[chain];

  if (!dataProvider || !viemChain) return [];

  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain: viemChain,
    transport: http(alchemyRpc(chain)),
  });

  try {
    // Batch 1: reserves list + baseCurrencyUnit (2 calls)
    const reserves = (await client.readContract({
      address: dataProvider,
      abi: DATA_PROVIDER_ABI,
      functionName: "getAllReservesTokens",
    })) as Array<{ symbol: string; tokenAddress: string }>;

    let baseCurrencyUnit = 10n ** 8n;
    if (oracleAddr) {
      try { baseCurrencyUnit = (await client.readContract({ address: oracleAddr, abi: ORACLE_ABI, functionName: "BASE_CURRENCY_UNIT" })) as bigint; } catch { /* default */ }
    }

    if (reserves.length === 0) return positions;

    // Batch 2: all per-reserve data in ONE multicall
    type MC = { status: "success" | "failure"; result?: unknown };
    const batch = (await client.multicall({
      contracts: [
        ...reserves.map((r) => ({ address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getUserReserveData", args: [r.tokenAddress as `0x${string}`, walletAddress as `0x${string}`] })),
        ...reserves.map((r) => ({ address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getReserveData",     args: [r.tokenAddress as `0x${string}`] })),
        ...reserves.map((r) => ({ address: r.tokenAddress as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" })),
        ...(oracleAddr ? reserves.map((r) => ({ address: oracleAddr, abi: ORACLE_ABI, functionName: "getAssetPrice", args: [r.tokenAddress as `0x${string}`] })) : []),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const n = reserves.length;
    const userDataResults   = batch.slice(0, n);
    const reserveDataResults = batch.slice(n, 2 * n);
    const decimalsResults   = batch.slice(2 * n, 3 * n);
    const priceResults      = oracleAddr ? batch.slice(3 * n, 4 * n) : [];

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
      const priceUsd = priceRaw > 0n ? Number(priceRaw) / Number(baseCurrencyUnit) : null;
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
            protocol: "aave",
            chain,
            position_type: "lend",
            asset_symbol: reserves[i].symbol,
            asset_address: reserves[i].tokenAddress,
            amount,
            price_usd: priceUsd,
            value_usd: valueUsd,
            is_debt: false,
            apy: depositApy,
          });
        }
      }

      if ((currentVariableDebt as bigint) > 0n) {
        const amount = Number(currentVariableDebt as bigint) / Number(divisor);
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol: "aave",
            chain,
            position_type: "borrow",
            asset_symbol: reserves[i].symbol,
            asset_address: reserves[i].tokenAddress,
            amount,
            price_usd: priceUsd,
            value_usd: valueUsd,
            is_debt: true,
            apy: -borrowApy,
          });
        }
      }
    }
  } catch (err) {
    console.error(`Aave V3 fetch error (${chain}):`, err);
  }

  return positions;
}
