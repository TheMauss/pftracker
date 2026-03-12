/**
 * Fetches MarginFi V2 lending/borrowing positions.
 * Uses Helius RPC `getProgramAccounts` to find the wallet's marginfi accounts,
 * then binary-parses the Anchor account layout to extract balance shares.
 * Bank metadata (symbol, price, APY) is fetched from the MarginFi REST API.
 */

import type { RawDefiPosition } from "../types";

const MARGINFI_PROGRAM = "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA";
const MARGINFI_BANKS_API = "https://api.marginfi.com/v2/banks";

// Helius RPC URL (same env var as chains/solana.ts)
function heliusUrl(): string {
  const val = process.env.HELIUS_API_KEY ?? "";
  const match = val.match(/api-key=([a-f0-9-]{36})/);
  const key = match ? match[1] : val;
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

interface BankMeta {
  address: string;
  tokenMint: string;
  tokenSymbol: string;
  depositApy: number;
  borrowApy: number;
  tokenPrice: number; // USD price per token
}

// Cache bank registry for 5 minutes
let bankCache: { data: BankMeta[]; fetchedAt: number } | null = null;

async function fetchBankRegistry(): Promise<Map<string, BankMeta>> {
  const now = Date.now();
  if (bankCache && now - bankCache.fetchedAt < 5 * 60_000) {
    return new Map(bankCache.data.map((b) => [b.address, b]));
  }
  try {
    const res = await fetch(MARGINFI_BANKS_API, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return new Map();
    const raw = await res.json();
    // Response may be array of banks or { banks: [...] }
    const arr: BankMeta[] = Array.isArray(raw) ? raw : raw?.banks ?? [];
    bankCache = { data: arr, fetchedAt: now };
    return new Map(arr.map((b) => [b.address, b]));
  } catch {
    return new Map();
  }
}

/**
 * Convert I80F48 fixed-point bytes (16 bytes little-endian) to a JS number.
 * I80F48 = 128-bit signed integer / 2^48
 */
function i80f48ToNumber(buf: Buffer, offset: number): number {
  // Read 16 bytes as little-endian BigInt
  let val = 0n;
  for (let i = 15; i >= 0; i--) {
    val = (val << 8n) | BigInt(buf[offset + i]);
  }
  // Handle two's complement for signed 128-bit
  if (val >= 1n << 127n) val -= 1n << 128n;
  // Divide by 2^48 to get float
  const divisor = 2n ** 48n;
  const intPart = val / divisor;
  const fracPart = val % divisor;
  return Number(intPart) + Number(fracPart) / Number(divisor);
}

export async function fetchMarginFiPositions(
  walletAddress: string
): Promise<RawDefiPosition[]> {
  const positions: RawDefiPosition[] = [];

  try {
    // Fetch bank registry and on-chain accounts in parallel
    const [bankMap, accountsRes] = await Promise.all([
      fetchBankRegistry(),
      fetch(heliusUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getProgramAccounts",
          params: [
            MARGINFI_PROGRAM,
            {
              encoding: "base64",
              filters: [
                // authority field at offset 40 (8 disc + 32 group)
                { memcmp: { offset: 40, bytes: walletAddress } },
              ],
            },
          ],
        }),
      }),
    ]);

    if (!accountsRes.ok) return positions;
    const json = await accountsRes.json();
    const accounts: Array<{ pubkey: string; account: { data: [string, string] } }> =
      json?.result ?? [];

    for (const acc of accounts) {
      const rawData = acc.account.data;
      if (!rawData?.[0]) continue;

      const buf = Buffer.from(rawData[0], "base64");
      if (buf.length < 80) continue;

      // Parse 16 balance slots starting at offset 80
      // Each Balance slot is 104 bytes:
      //   0:  1  active (bool)
      //   1:  32 bank_pk (pubkey)
      //  33:  7  _padding0
      //  40: 16  asset_shares (I80F48)
      //  56: 16  liability_shares (I80F48)
      //  72:  1  bank_asset_tag
      //  73: 31  _padding1
      const BALANCE_OFFSET = 80;
      const BALANCE_SIZE = 104;
      const NUM_BALANCES = 16;

      for (let i = 0; i < NUM_BALANCES; i++) {
        const base = BALANCE_OFFSET + i * BALANCE_SIZE;
        if (base + BALANCE_SIZE > buf.length) break;

        const active = buf[base];
        if (!active) continue;

        // Read bank_pk as base58 — just use hex as a lookup key for now
        const bankPkBytes = buf.slice(base + 1, base + 33);
        // Convert to base58 string
        const bankAddress = toBase58(bankPkBytes);

        const assetShares = i80f48ToNumber(buf, base + 40);
        const liabilityShares = i80f48ToNumber(buf, base + 56);

        const bank = bankMap.get(bankAddress);
        const symbol = bank?.tokenSymbol ?? "UNKNOWN";
        const priceUsd = bank?.tokenPrice ?? null;
        const depositApy = bank?.depositApy ?? null;
        const borrowApy = bank?.borrowApy ?? null;

        // The shares represent token amounts at approximately 1:1 (marginfi uses
        // share prices that start at 1.0 and accrue interest). For a reasonable
        // approximation, treat shares ≈ token amounts.
        if (assetShares > 0.0001) {
          const valueUsd = priceUsd ? assetShares * priceUsd : 0;
          if (valueUsd < 0.01 && priceUsd !== null) continue;
          positions.push({
            protocol: "marginfi",
            chain: "solana",
            position_type: "lend",
            asset_symbol: symbol,
            asset_address: bank?.tokenMint ?? undefined,
            amount: assetShares,
            price_usd: priceUsd,
            value_usd: valueUsd,
            is_debt: false,
            apy: depositApy,
          });
        }

        if (liabilityShares > 0.0001) {
          const valueUsd = priceUsd ? liabilityShares * priceUsd : 0;
          if (valueUsd < 0.01 && priceUsd !== null) continue;
          positions.push({
            protocol: "marginfi",
            chain: "solana",
            position_type: "borrow",
            asset_symbol: symbol,
            asset_address: bank?.tokenMint ?? undefined,
            amount: liabilityShares,
            price_usd: priceUsd,
            value_usd: valueUsd,
            is_debt: true,
            apy: borrowApy != null ? -borrowApy : null,
          });
        }
      }
    }
  } catch (err) {
    console.error("MarginFi fetch error:", err);
  }

  return positions;
}

// Minimal base58 encoder for Solana public keys
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function toBase58(bytes: Buffer): string {
  let num = BigInt("0x" + bytes.toString("hex"));
  const result: string[] = [];
  while (num > 0n) {
    result.unshift(BASE58_ALPHABET[Number(num % 58n)]);
    num = num / 58n;
  }
  // Leading zeros
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result.unshift("1");
  }
  return result.join("");
}
