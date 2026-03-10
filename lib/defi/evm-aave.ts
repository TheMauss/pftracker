/**
 * Fetches Aave V3 positions on Ethereum, Base, and Arbitrum.
 * Uses viem to read from Aave's PoolDataProvider contract.
 */

import type { RawDefiPosition, ChainId } from "../types";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet, base, arbitrum } from "viem/chains";

const AAVE_DATA_PROVIDERS: Record<string, `0x${string}`> = {
  ethereum: "0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3",
  base: "0x2d8A3C5677189723C4cB8873CfC9C8976dfe498b",
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
    transport: http(),
  });

  try {
    const reserves = (await client.readContract({
      address: dataProvider,
      abi: DATA_PROVIDER_ABI,
      functionName: "getAllReservesTokens",
    })) as Array<{ symbol: string; tokenAddress: string }>;

    const [userDataResults, reserveDataResults, decimalsResults, priceResults] =
      await Promise.all([
        Promise.all(
          reserves.map((r) =>
            client
              .readContract({
                address: dataProvider,
                abi: DATA_PROVIDER_ABI,
                functionName: "getUserReserveData",
                args: [r.tokenAddress as `0x${string}`, walletAddress as `0x${string}`],
              })
              .catch(() => null)
          )
        ),
        Promise.all(
          reserves.map((r) =>
            client
              .readContract({
                address: dataProvider,
                abi: DATA_PROVIDER_ABI,
                functionName: "getReserveData",
                args: [r.tokenAddress as `0x${string}`],
              })
              .catch(() => null)
          )
        ),
        Promise.all(
          reserves.map((r) =>
            client
              .readContract({
                address: r.tokenAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: "decimals",
              })
              .catch(() => 18n)
          )
        ),
        oracleAddr
          ? Promise.all(
              reserves.map((r) =>
                client
                  .readContract({
                    address: oracleAddr,
                    abi: ORACLE_ABI,
                    functionName: "getAssetPrice",
                    args: [r.tokenAddress as `0x${string}`],
                  })
                  .catch(() => 0n)
              )
            )
          : Promise.resolve(reserves.map(() => 0n)),
      ]);

    let baseCurrencyUnit = 10n ** 8n;
    if (oracleAddr) {
      try {
        baseCurrencyUnit = (await client.readContract({
          address: oracleAddr,
          abi: ORACLE_ABI,
          functionName: "BASE_CURRENCY_UNIT",
        })) as bigint;
      } catch {
        // default
      }
    }

    for (let i = 0; i < reserves.length; i++) {
      const userData = userDataResults[i] as bigint[] | null;
      if (!userData) continue;

      const [currentATokenBalance, , currentVariableDebt] = userData;
      const decimals = Number(decimalsResults[i] as bigint ?? 18n);
      const divisor = 10n ** BigInt(decimals);
      const priceRaw = priceResults[i] as bigint ?? 0n;
      const priceUsd = priceRaw > 0n ? Number(priceRaw) / Number(baseCurrencyUnit) : null;
      const reserveData = reserveDataResults[i] as bigint[] | null;
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
