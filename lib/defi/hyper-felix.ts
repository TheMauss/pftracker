/**
 * Fetches Felix Protocol positions on HyperEVM.
 * Felix = Liquity V2 fork (CDPs) + Morpho lending markets.
 *
 * feUSD token: 0x02c6a2fa58cc01a18b8d9e00ea48d65e4df26c70
 * Morpho Vault (USDT0): 0x9896a8605763106e57A51aa0a97Fe8099E806bb3
 * Morpho Vault (USDH):  0x207ccaE51Ad2E1C240C4Ab4c94b670D438d2201C
 */

import type { RawDefiPosition } from "../types";
import { createPublicClient, http, parseAbi } from "viem";

const HYPEREVM_RPC = "https://rpc.hyperliquid.xyz/evm";

const hyperevmChain = {
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPEREVM_RPC] } },
} as const;

// Morpho ERC4626 vault ABI
const VAULT_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function convertToAssets(uint256 shares) external view returns (uint256)",
  "function asset() external view returns (address)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function totalAssets() external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
]);

// Liquity V2 Trove Manager ABI (CDP)
const TROVE_MANAGER_ABI = parseAbi([
  "function getTroveStatus(address _borrower) external view returns (uint256)",
  "function getTroveColl(address _borrower) external view returns (uint256)",
  "function getTroveDebt(address _borrower) external view returns (uint256)",
]);

// Felix collateral tokens and trove managers (add as more are discovered)
const FELIX_MORPHO_VAULTS: Array<{
  address: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  assetPriceUsd: number | null; // stablecoins = 1.0
}> = [
  {
    address: "0x9896a8605763106e57A51aa0a97Fe8099E806bb3",
    assetSymbol: "USDT0",
    assetDecimals: 6,
    assetPriceUsd: 1.0,
  },
  {
    address: "0x207ccaE51Ad2E1C240C4Ab4c94b670D438d2201C",
    assetSymbol: "USDH",
    assetDecimals: 18,
    assetPriceUsd: 1.0,
  },
];

export async function fetchFelixPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  const client = createPublicClient({
    chain: hyperevmChain,
    transport: http(HYPEREVM_RPC),
  });

  // ─── Morpho vault deposits ────────────────────────────────────────────────
  for (const vault of FELIX_MORPHO_VAULTS) {
    try {
      const [sharesBig, assetsBig] = await Promise.all([
        client.readContract({
          address: vault.address,
          abi: VAULT_ABI,
          functionName: "balanceOf",
          args: [walletAddress as `0x${string}`],
        }) as Promise<bigint>,
        client
          .readContract({
            address: vault.address,
            abi: VAULT_ABI,
            functionName: "convertToAssets",
            args: [1n], // will compute per-share below
          })
          .catch(() => 1n) as Promise<bigint>,
      ]);

      if ((sharesBig as bigint) === 0n) continue;

      // Get actual assets for user's shares
      const userAssets = await client.readContract({
        address: vault.address,
        abi: VAULT_ABI,
        functionName: "convertToAssets",
        args: [sharesBig as bigint],
      }) as bigint;

      const amount =
        Number(userAssets) / Math.pow(10, vault.assetDecimals);
      const priceUsd = vault.assetPriceUsd;
      const valueUsd = priceUsd ? amount * priceUsd : 0;

      if (valueUsd < 0.01) continue;

      positions.push({
        protocol: "felix",
        chain: "hyperevm",
        position_type: "lend",
        asset_symbol: vault.assetSymbol,
        asset_address: vault.address,
        amount,
        price_usd: priceUsd,
        value_usd: valueUsd,
        is_debt: false,
        apy: null, // APY from Morpho not easily accessible without additional calls
        extra_data: { vault: vault.address, type: "morpho_vault" },
      });
    } catch (err) {
      console.error(`Felix vault ${vault.address} error:`, err);
    }
  }

  // ─── feUSD balance (CDP minted stablecoin held in wallet) ─────────────────
  const FEUSD = "0x02c6a2fa58cc01a18b8d9e00ea48d65e4df26c70" as const;
  try {
    const balance = await client.readContract({
      address: FEUSD,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [walletAddress as `0x${string}`],
    }) as bigint;

    const amount = Number(balance) / 1e18;
    if (amount > 0.01) {
      positions.push({
        protocol: "felix",
        chain: "hyperevm",
        position_type: "vault",
        asset_symbol: "feUSD",
        asset_address: FEUSD,
        amount,
        price_usd: 1.0,
        value_usd: amount,
        is_debt: false,
        apy: null,
        extra_data: { type: "stablecoin_balance" },
      });
    }
  } catch {
    // feUSD not held
  }

  return positions;
}
