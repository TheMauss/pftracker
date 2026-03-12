/**
 * Fetches Lido staking positions (stETH / wstETH) on Ethereum.
 * stETH is a rebasing token (balance ≈ staked ETH amount).
 * wstETH is the wrapped version; we convert it to stETH via getStETHByWstETH().
 *
 * Note: stETH/wstETH will also appear in the EVM token list from Alchemy.
 * To avoid double-counting, evm.ts marks their addresses as is_derivative=true.
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";

const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84" as const;
const WSTETH_ADDRESS = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as const;
const LIDO_APR_URL = "https://eth-api.lido.fi/v1/protocol/steth/apr/sma";

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
]);

const WSTETH_ABI = parseAbi([
  "function getStETHByWstETH(uint256 wstETHAmount) external view returns (uint256)",
]);

function alchemyEthUrl(): string {
  const key = process.env.ALCHEMY_API_KEY ?? "";
  return `https://eth-mainnet.g.alchemy.com/v2/${key}`;
}

async function fetchLidoApr(): Promise<number | null> {
  try {
    const res = await fetch(LIDO_APR_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const json = await res.json();
    // Response: { data: { smaApr: number, ... } }
    return json?.data?.smaApr ?? json?.data?.aprs?.smaApr ?? null;
  } catch {
    return null;
  }
}

export async function fetchLidoPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(alchemyEthUrl()),
    });

    const addr = walletAddress as `0x${string}`;

    // Read balances + wstETH→stETH conversion in one multicall
    type MC = { status: "success" | "failure"; result?: unknown };
    const results = (await client.multicall({
      contracts: [
        { address: STETH_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] },
        { address: WSTETH_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as MC[];

    const stethRaw = results[0]?.status === "success" ? (results[0].result as bigint) : 0n;
    const wstethRaw = results[1]?.status === "success" ? (results[1].result as bigint) : 0n;

    // Convert wstETH to stETH equivalent
    let wstethAsSteth = 0n;
    if (wstethRaw > 0n) {
      try {
        const converted = await client.readContract({
          address: WSTETH_ADDRESS,
          abi: WSTETH_ABI,
          functionName: "getStETHByWstETH",
          args: [wstethRaw],
        }) as bigint;
        wstethAsSteth = converted;
      } catch {
        // fallback: approximate 1:1 (conservative)
        wstethAsSteth = wstethRaw;
      }
    }

    const totalSteth = Number(stethRaw + wstethAsSteth) / 1e18;
    if (totalSteth < 0.001) return positions;

    // Fetch ETH price via CoinGecko (simple call)
    let ethPrice: number | null = null;
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        { signal: AbortSignal.timeout(8_000) }
      );
      if (res.ok) {
        const json = await res.json();
        ethPrice = json?.ethereum?.usd ?? null;
      }
    } catch {}

    const apy = await fetchLidoApr();
    const valueUsd = ethPrice ? totalSteth * ethPrice : 0;

    if (stethRaw > 0n) {
      const stethAmount = Number(stethRaw) / 1e18;
      positions.push({
        protocol: "lido",
        chain: "ethereum",
        position_type: "stake",
        asset_symbol: "stETH",
        asset_address: STETH_ADDRESS,
        amount: stethAmount,
        price_usd: ethPrice,
        value_usd: ethPrice ? stethAmount * ethPrice : 0,
        is_debt: false,
        apy,
      });
    }

    if (wstethRaw > 0n) {
      const wstethAmount = Number(wstethRaw) / 1e18;
      const wstethUsd = ethPrice ? (Number(wstethAsSteth) / 1e18) * ethPrice : 0;
      positions.push({
        protocol: "lido",
        chain: "ethereum",
        position_type: "stake",
        asset_symbol: "wstETH",
        asset_address: WSTETH_ADDRESS,
        amount: wstethAmount,
        price_usd: wstethUsd > 0 && wstethAmount > 0 ? wstethUsd / wstethAmount : ethPrice,
        value_usd: wstethUsd,
        is_debt: false,
        apy,
      });
    }

    void valueUsd; // used indirectly above
  } catch (err) {
    console.error("Lido fetch error:", err);
  }

  return positions;
}
