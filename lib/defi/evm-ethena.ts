/**
 * Fetches Ethena sUSDe staking positions on Ethereum.
 * sUSDe is an ERC-4626 vault token. We use `convertToAssets` to get
 * the underlying USDe value, then price it at $1 (USDe ≈ $1).
 *
 * Note: sUSDe will also appear in the EVM token list from Alchemy.
 * To avoid double-counting, evm.ts marks the sUSDe address as is_derivative=true.
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";

// sUSDe on Ethereum
const SUSDE_ADDRESS = "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497" as const;
const ETHENA_STATS_URL = "https://app.ethena.fi/api/yields/protocol-and-staking-yield";

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) external view returns (uint256)",
]);

const ERC4626_ABI = parseAbi([
  "function convertToAssets(uint256 shares) external view returns (uint256)",
]);

function alchemyEthUrl(): string {
  const key = process.env.ALCHEMY_API_KEY ?? "";
  return `https://eth-mainnet.g.alchemy.com/v2/${key}`;
}

async function fetchEthenaApy(): Promise<number | null> {
  try {
    const res = await fetch(ETHENA_STATS_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const json = await res.json();
    // Response shape varies; try common fields
    const apy =
      json?.stakingYield?.value ??
      json?.sUSDe?.apy ??
      json?.apy ??
      null;
    return typeof apy === "number" ? apy : null;
  } catch {
    return null;
  }
}

export async function fetchEthenaPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(alchemyEthUrl()),
    });

    const addr = walletAddress as `0x${string}`;

    // Read sUSDe balance
    const balance = (await client.readContract({
      address: SUSDE_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [addr],
    })) as bigint;

    if (balance <= 0n) return positions;

    // Convert sUSDe shares → USDe (underlying asset)
    let underlyingUsde = balance; // fallback: 1:1
    try {
      underlyingUsde = (await client.readContract({
        address: SUSDE_ADDRESS,
        abi: ERC4626_ABI,
        functionName: "convertToAssets",
        args: [balance],
      })) as bigint;
    } catch {}

    const sharesAmount = Number(balance) / 1e18;
    const usdeAmount = Number(underlyingUsde) / 1e18;

    if (sharesAmount < 0.01) return positions;

    // USDe is pegged to $1
    const valueUsd = usdeAmount;
    const pricePerShare = sharesAmount > 0 ? valueUsd / sharesAmount : 1;

    const apy = await fetchEthenaApy();

    positions.push({
      protocol: "ethena" as never, // ethena not in ProtocolId yet
      chain: "ethereum",
      position_type: "vault",
      asset_symbol: "sUSDe",
      asset_address: SUSDE_ADDRESS,
      amount: sharesAmount,
      price_usd: pricePerShare,
      value_usd: valueUsd,
      is_debt: false,
      apy,
      extra_data: { underlyingUsde: usdeAmount },
    });
  } catch (err) {
    console.error("Ethena fetch error:", err);
  }

  return positions;
}
