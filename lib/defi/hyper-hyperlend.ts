/**
 * Fetches Hyperlend positions on HyperEVM (chain 999).
 * Hyperlend is an Aave V3 fork.
 * Uses viem to read from the ProtocolDataProvider contract.
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi } from "viem";

const HYPEREVM_RPC = "https://rpc.hyperliquid.xyz/evm";
const CHAIN_ID = 999;

// Hyperlend contract addresses on HyperEVM
const PROTOCOL_DATA_PROVIDER = "0x5481bf8d3946E6A3168640c1D7523eB59F055a29" as const;
const POOL_ADDRESS_PROVIDER = "0x72c98246a98bFe64022a3190e7710E157497170C" as const;

const DATA_PROVIDER_ABI = parseAbi([
  "function getAllReservesTokens() external view returns ((string symbol, address tokenAddress)[])",
  "function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableScalingFactor, uint256 liquidityRate, bool usageAsCollateralEnabled, bool stableBorrowRateEnabled)",
  "function getReserveData(address asset) external view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
]);

// Simple oracle ABI for price (Aave uses Chainlink oracles)
const ORACLE_ABI = parseAbi([
  "function getAssetPrice(address asset) external view returns (uint256)",
  "function BASE_CURRENCY_UNIT() external view returns (uint256)",
]);

const ORACLE_ADDRESS = "0xC9Fb4fbE842d57EAc1dF3e641a281827493A630e" as const;

// Ray = 1e27 for interest rate calculations
const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31536000n;

function rayToApy(rayRate: bigint): number {
  // APY = (1 + rate/SECONDS_PER_YEAR)^SECONDS_PER_YEAR - 1 (approximation)
  const ratePerSecond = Number(rayRate) / Number(RAY) / Number(SECONDS_PER_YEAR);
  return (Math.pow(1 + ratePerSecond, Number(SECONDS_PER_YEAR)) - 1) * 100;
}

const hyperevmChain = {
  id: CHAIN_ID,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPEREVM_RPC] } },
} as const;

export async function fetchHyperlendPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain: hyperevmChain,
    transport: http(HYPEREVM_RPC),
  });

  try {
    // Get all reserve tokens
    const reserves = await client.readContract({
      address: PROTOCOL_DATA_PROVIDER,
      abi: DATA_PROVIDER_ABI,
      functionName: "getAllReservesTokens",
    });

    // Batch fetch user data for all reserves
    const userDataPromises = (reserves as Array<{ symbol: string; tokenAddress: string }>).map(
      (reserve) =>
        client
          .readContract({
            address: PROTOCOL_DATA_PROVIDER,
            abi: DATA_PROVIDER_ABI,
            functionName: "getUserReserveData",
            args: [reserve.tokenAddress as `0x${string}`, walletAddress as `0x${string}`],
          })
          .catch(() => null)
    );

    // Batch fetch reserve data for APYs
    const reserveDataPromises = (reserves as Array<{ symbol: string; tokenAddress: string }>).map(
      (reserve) =>
        client
          .readContract({
            address: PROTOCOL_DATA_PROVIDER,
            abi: DATA_PROVIDER_ABI,
            functionName: "getReserveData",
            args: [reserve.tokenAddress as `0x${string}`],
          })
          .catch(() => null)
    );

    // Batch fetch decimals
    const decimalsPromises = (reserves as Array<{ symbol: string; tokenAddress: string }>).map(
      (reserve) =>
        client
          .readContract({
            address: reserve.tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "decimals",
          })
          .catch(() => 18n)
    );

    // Fetch oracle prices
    const pricePromises = (reserves as Array<{ symbol: string; tokenAddress: string }>).map(
      (reserve) =>
        client
          .readContract({
            address: ORACLE_ADDRESS,
            abi: ORACLE_ABI,
            functionName: "getAssetPrice",
            args: [reserve.tokenAddress as `0x${string}`],
          })
          .catch(() => 0n)
    );

    const [userDataResults, reserveDataResults, decimalsResults, priceResults] =
      await Promise.all([
        Promise.all(userDataPromises),
        Promise.all(reserveDataPromises),
        Promise.all(decimalsPromises),
        Promise.all(pricePromises),
      ]);

    // Oracle base currency unit (usually 1e8 for USD)
    let baseCurrencyUnit = 10n ** 8n;
    try {
      baseCurrencyUnit = await client.readContract({
        address: ORACLE_ADDRESS,
        abi: ORACLE_ABI,
        functionName: "BASE_CURRENCY_UNIT",
      }) as bigint;
    } catch {
      // default to 1e8
    }

    const reserveList = reserves as Array<{ symbol: string; tokenAddress: string }>;

    for (let i = 0; i < reserveList.length; i++) {
      const userData = userDataResults[i];
      if (!userData) continue;

      const [
        currentATokenBalance,
        ,
        currentVariableDebt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] = userData as any as bigint[];

      const decimals = Number(decimalsResults[i] ?? 18n);
      const divisor = 10n ** BigInt(decimals);

      const priceRaw = priceResults[i] as bigint ?? 0n;
      const priceUsd =
        priceRaw > 0n
          ? Number(priceRaw) / Number(baseCurrencyUnit)
          : null;

      const reserveData = reserveDataResults[i] as bigint[] | null;
      const liquidityRate = reserveData?.[5] ?? 0n;
      const variableBorrowRate = reserveData?.[6] ?? 0n;
      const depositApy = rayToApy(liquidityRate as bigint);
      const borrowApy = rayToApy(variableBorrowRate as bigint);

      // Deposits
      if ((currentATokenBalance as bigint) > 0n) {
        const amount = Number(currentATokenBalance as bigint) / Number(divisor);
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol: "hyperlend",
            chain: "hyperevm",
            position_type: "lend",
            asset_symbol: reserveList[i].symbol,
            asset_address: reserveList[i].tokenAddress,
            amount,
            price_usd: priceUsd,
            value_usd: valueUsd,
            is_debt: false,
            apy: depositApy,
          });
        }
      }

      // Variable borrows
      if ((currentVariableDebt as bigint) > 0n) {
        const amount = Number(currentVariableDebt as bigint) / Number(divisor);
        const valueUsd = priceUsd ? amount * priceUsd : 0;
        if (valueUsd > 0.01 || !priceUsd) {
          positions.push({
            protocol: "hyperlend",
            chain: "hyperevm",
            position_type: "borrow",
            asset_symbol: reserveList[i].symbol,
            asset_address: reserveList[i].tokenAddress,
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
    console.error("Hyperlend fetch error:", err);
  }

  return positions;
}
