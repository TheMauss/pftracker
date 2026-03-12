// Wallet chain types (user-facing)
export type WalletChain = "solana" | "evm" | "sui" | "bitcoin";

// Internal chain identifiers (used for tokens and DeFi positions)
export type ChainId =
  | "solana"
  | "evm"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "bsc"
  | "hyperliquid"
  | "hyperevm"
  | "sui"
  | "bitcoin";

// DeFi protocol names
export type ProtocolId =
  | "kamino"
  | "jlp"
  | "drift"
  | "marginfi"
  | "orca"
  | "raydium"
  | "meteora"
  | "felix"
  | "hyperlend"
  | "pendle"
  | "aave"
  | "compound"
  | "spark"
  | "morpho"
  | "venus"
  | "moonwell"
  | "seamless"
  | "navi"
  | "scallop"
  | "cetus"
  | "uniswap"
  | "gmx"
  | "lido"
  | "rocketpool"
  | "jito"
  | "marinade";

export type PositionType =
  | "lend"
  | "borrow"
  | "lp"
  | "stake"
  | "perp"
  | "pt"
  | "yt"
  | "vault"
  | "cdp";

// ─── Database row types ───────────────────────────────────────────────────────

export interface Wallet {
  id: number;
  address: string;
  chain: ChainId;
  label: string | null;
  deleted_at: string | null;
}

export interface Snapshot {
  id: number;
  taken_at: string;
  total_usd: number;
  status: "ok" | "partial";
}

export interface WalletSnapshot {
  id: number;
  snapshot_id: number;
  wallet_id: number;
  total_usd: number;
  token_usd: number;
  defi_deposit_usd: number;
  defi_borrow_usd: number;
}

export interface TokenBalance {
  id: number;
  snapshot_id: number;
  wallet_id: number;
  token_symbol: string;
  token_name: string | null;
  token_address: string | null;
  chain: ChainId;
  amount: number;
  price_usd: number | null;
  value_usd: number;
  is_derivative: number; // 0 | 1 (SQLite boolean)
}

export interface DefiPosition {
  id: number;
  snapshot_id: number;
  wallet_id: number;
  protocol: ProtocolId;
  chain: ChainId;
  position_type: PositionType;
  asset_symbol: string;
  asset_address: string | null;
  amount: number;
  price_usd: number | null;
  value_usd: number;
  is_debt: number; // 0 | 1
  apy: number | null;
  extra_data: string | null; // JSON string
}

// ─── Fetcher return types (before DB insert) ─────────────────────────────────

export interface RawTokenBalance {
  token_symbol: string;
  token_name?: string;
  token_address?: string;
  chain: ChainId;
  amount: number;
  price_usd?: number | null;
  value_usd: number;
  is_derivative?: boolean;
}

export interface RawDefiPosition {
  protocol: ProtocolId;
  chain: ChainId;
  position_type: PositionType;
  asset_symbol: string;
  asset_address?: string;
  amount: number;
  price_usd?: number | null;
  value_usd: number;
  is_debt?: boolean;
  apy?: number | null;
  extra_data?: Record<string, unknown>;
}

// ─── API response types ───────────────────────────────────────────────────────

export interface WalletPortfolioData {
  wallet: Wallet;
  token_usd: number;
  defi_deposit_usd: number;
  defi_borrow_usd: number;
  total_usd: number;
  tokens: RawTokenBalance[];
  defi_positions: RawDefiPosition[];
  errors: string[]; // per-protocol fetch errors
}

export interface PortfolioResponse {
  total_usd: number;
  token_usd: number;
  defi_deposit_usd: number;
  defi_borrow_usd: number;
  wallets: WalletPortfolioData[];
  by_chain: ChainAllocation[];
  by_protocol: ProtocolAllocation[];
  top_tokens: RawTokenBalance[];
  unknown_price_count: number;
  fetched_at: string;
}

export interface ChainAllocation {
  chain: ChainId;
  value_usd: number;
  pct: number;
}

export interface ProtocolAllocation {
  protocol: string;
  chain: ChainId;
  value_usd: number;
  pct: number;
}

export interface SnapshotHistoryPoint {
  snapshot_id: number;
  taken_at: string;
  total_usd: number;
}

export interface WalletPnL {
  wallet_id: number;
  wallet_label: string | null;
  wallet_address: string;
  chain: ChainId;
  current_usd: number;
  pnl_1d: number | null;
  pnl_7d: number | null;
  pnl_30d: number | null;
  pnl_all: number | null;
}

export interface SnapshotsResponse {
  history: SnapshotHistoryPoint[];
  wallet_history: {
    wallet_id: number;
    wallet_label: string | null;
    chain: ChainId;
    history: Array<{ taken_at: string; total_usd: number }>;
  }[];
  pnl: {
    total_1d: number | null;
    total_7d: number | null;
    total_30d: number | null;
    total_all: number | null;
    by_wallet: WalletPnL[];
  };
}
