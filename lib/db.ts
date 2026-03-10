import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type {
  Wallet,
  Snapshot,
  WalletSnapshot,
  TokenBalance,
  DefiPosition,
  ChainId,
  SnapshotHistoryPoint,
} from "./types";

const DB_PATH = process.env.DB_PATH ?? "./data/portfolio.db";

// Singleton pattern — survives Next.js dev hot-reloads
const globalForDb = global as typeof global & { _db?: Database.Database };

function getDb(): Database.Database {
  if (!globalForDb._db) {
    const absPath = path.resolve(DB_PATH);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const db = new Database(absPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    globalForDb._db = db;
  }
  return globalForDb._db;
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      address    TEXT NOT NULL,
      chain      TEXT NOT NULL,
      label      TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      taken_at  TEXT NOT NULL,
      total_usd REAL NOT NULL,
      status    TEXT NOT NULL DEFAULT 'ok'
    );

    CREATE TABLE IF NOT EXISTS wallet_snapshots (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id      INTEGER NOT NULL REFERENCES snapshots(id),
      wallet_id        INTEGER NOT NULL REFERENCES wallets(id),
      total_usd        REAL NOT NULL,
      token_usd        REAL NOT NULL,
      defi_deposit_usd REAL NOT NULL DEFAULT 0,
      defi_borrow_usd  REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS token_balances (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id),
      wallet_id     INTEGER NOT NULL REFERENCES wallets(id),
      token_symbol  TEXT NOT NULL,
      token_name    TEXT,
      token_address TEXT,
      chain         TEXT NOT NULL,
      amount        REAL NOT NULL,
      price_usd     REAL,
      value_usd     REAL NOT NULL,
      is_derivative INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS defi_positions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id),
      wallet_id     INTEGER NOT NULL REFERENCES wallets(id),
      protocol      TEXT NOT NULL,
      chain         TEXT NOT NULL,
      position_type TEXT NOT NULL,
      asset_symbol  TEXT NOT NULL,
      asset_address TEXT,
      amount        REAL NOT NULL,
      price_usd     REAL,
      value_usd     REAL NOT NULL,
      is_debt       INTEGER NOT NULL DEFAULT 0,
      apy           REAL,
      extra_data    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_taken_at    ON snapshots(taken_at);
    CREATE INDEX IF NOT EXISTS idx_wallet_snap_snap_id   ON wallet_snapshots(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_snap_wallet_id ON wallet_snapshots(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_token_bal_snap_id     ON token_balances(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_defi_pos_snap_id      ON defi_positions(snapshot_id);
  `);
}

// ─── Wallet queries ───────────────────────────────────────────────────────────

export function getWallets(): Wallet[] {
  return getDb()
    .prepare("SELECT * FROM wallets WHERE deleted_at IS NULL ORDER BY id")
    .all() as Wallet[];
}

export function getWalletById(id: number): Wallet | undefined {
  return getDb()
    .prepare("SELECT * FROM wallets WHERE id = ?")
    .get(id) as Wallet | undefined;
}

export function insertWallet(
  address: string,
  chain: ChainId,
  label?: string
): number {
  const result = getDb()
    .prepare(
      "INSERT INTO wallets (address, chain, label) VALUES (?, ?, ?)"
    )
    .run(address, chain, label ?? null);
  return result.lastInsertRowid as number;
}

export function softDeleteWallet(id: number): void {
  getDb()
    .prepare("UPDATE wallets SET deleted_at = datetime('now') WHERE id = ?")
    .run(id);
}

export function updateWalletLabel(id: number, label: string): void {
  getDb()
    .prepare("UPDATE wallets SET label = ? WHERE id = ?")
    .run(label, id);
}

// ─── Snapshot queries ─────────────────────────────────────────────────────────

export function getSnapshotForToday(pragueDate: string): Snapshot | undefined {
  // pragueDate = "YYYY-MM-DD" in Europe/Prague timezone
  return getDb()
    .prepare(
      "SELECT * FROM snapshots WHERE taken_at LIKE ? ORDER BY taken_at DESC LIMIT 1"
    )
    .get(`${pragueDate}%`) as Snapshot | undefined;
}

export function getLatestSnapshot(): Snapshot | undefined {
  return getDb()
    .prepare("SELECT * FROM snapshots ORDER BY taken_at DESC LIMIT 1")
    .get() as Snapshot | undefined;
}

export function getSnapshotHistory(
  from?: string,
  to?: string
): SnapshotHistoryPoint[] {
  if (from && to) {
    return getDb()
      .prepare(
        "SELECT id as snapshot_id, taken_at, total_usd FROM snapshots WHERE taken_at >= ? AND taken_at <= ? ORDER BY taken_at ASC"
      )
      .all(from, to) as SnapshotHistoryPoint[];
  }
  return getDb()
    .prepare(
      "SELECT id as snapshot_id, taken_at, total_usd FROM snapshots ORDER BY taken_at ASC"
    )
    .all() as SnapshotHistoryPoint[];
}

export function getSnapshotNDaysAgo(n: number): Snapshot | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM snapshots WHERE taken_at <= datetime('now', '-${n} days') ORDER BY taken_at DESC LIMIT 1`
    )
    .get() as Snapshot | undefined;
}

export function getFirstSnapshot(): Snapshot | undefined {
  return getDb()
    .prepare("SELECT * FROM snapshots ORDER BY taken_at ASC LIMIT 1")
    .get() as Snapshot | undefined;
}

// ─── Write snapshot (transactional) ──────────────────────────────────────────

export interface SnapshotInsertData {
  total_usd: number;
  status: "ok" | "partial";
  taken_at: string;
  wallets: Array<{
    wallet_id: number;
    total_usd: number;
    token_usd: number;
    defi_deposit_usd: number;
    defi_borrow_usd: number;
    tokens: Array<{
      token_symbol: string;
      token_name?: string | null;
      token_address?: string | null;
      chain: string;
      amount: number;
      price_usd?: number | null;
      value_usd: number;
      is_derivative?: boolean;
    }>;
    defi_positions: Array<{
      protocol: string;
      chain: string;
      position_type: string;
      asset_symbol: string;
      asset_address?: string | null;
      amount: number;
      price_usd?: number | null;
      value_usd: number;
      is_debt?: boolean;
      apy?: number | null;
      extra_data?: Record<string, unknown> | null;
    }>;
  }>;
}

export function writeSnapshot(data: SnapshotInsertData): number {
  const db = getDb();

  const insertSnapshot = db.prepare(
    "INSERT INTO snapshots (taken_at, total_usd, status) VALUES (?, ?, ?)"
  );
  const insertWalletSnap = db.prepare(
    `INSERT INTO wallet_snapshots
       (snapshot_id, wallet_id, total_usd, token_usd, defi_deposit_usd, defi_borrow_usd)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertToken = db.prepare(
    `INSERT INTO token_balances
       (snapshot_id, wallet_id, token_symbol, token_name, token_address, chain,
        amount, price_usd, value_usd, is_derivative)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertDefi = db.prepare(
    `INSERT INTO defi_positions
       (snapshot_id, wallet_id, protocol, chain, position_type, asset_symbol,
        asset_address, amount, price_usd, value_usd, is_debt, apy, extra_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const run = db.transaction(() => {
    const snapResult = insertSnapshot.run(
      data.taken_at,
      data.total_usd,
      data.status
    );
    const snapId = snapResult.lastInsertRowid as number;

    for (const w of data.wallets) {
      insertWalletSnap.run(
        snapId,
        w.wallet_id,
        w.total_usd,
        w.token_usd,
        w.defi_deposit_usd,
        w.defi_borrow_usd
      );

      for (const t of w.tokens) {
        insertToken.run(
          snapId,
          w.wallet_id,
          t.token_symbol,
          t.token_name ?? null,
          t.token_address ?? null,
          t.chain,
          t.amount,
          t.price_usd ?? null,
          t.value_usd,
          t.is_derivative ? 1 : 0
        );
      }

      for (const d of w.defi_positions) {
        insertDefi.run(
          snapId,
          w.wallet_id,
          d.protocol,
          d.chain,
          d.position_type,
          d.asset_symbol,
          d.asset_address ?? null,
          d.amount,
          d.price_usd ?? null,
          d.value_usd,
          d.is_debt ? 1 : 0,
          d.apy ?? null,
          d.extra_data ? JSON.stringify(d.extra_data) : null
        );
      }
    }

    return snapId;
  });

  return run() as number;
}

// ─── Historical wallet data ───────────────────────────────────────────────────

export function getWalletHistory(
  walletId: number,
  from?: string,
  to?: string
): Array<{ taken_at: string; total_usd: number }> {
  const base = `
    SELECT s.taken_at, ws.total_usd
    FROM wallet_snapshots ws
    JOIN snapshots s ON s.id = ws.snapshot_id
    WHERE ws.wallet_id = ?
  `;
  if (from && to) {
    return getDb()
      .prepare(base + " AND s.taken_at >= ? AND s.taken_at <= ? ORDER BY s.taken_at ASC")
      .all(walletId, from, to) as Array<{ taken_at: string; total_usd: number }>;
  }
  return getDb()
    .prepare(base + " ORDER BY s.taken_at ASC")
    .all(walletId) as Array<{ taken_at: string; total_usd: number }>;
}

export function getWalletSnapshotAt(
  walletId: number,
  snapshotId: number
): WalletSnapshot | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM wallet_snapshots WHERE wallet_id = ? AND snapshot_id = ?"
    )
    .get(walletId, snapshotId) as WalletSnapshot | undefined;
}

export function getLatestDefiPositions(walletId: number): DefiPosition[] {
  const latest = getDb()
    .prepare(
      `SELECT snapshot_id FROM wallet_snapshots WHERE wallet_id = ? ORDER BY snapshot_id DESC LIMIT 1`
    )
    .get(walletId) as { snapshot_id: number } | undefined;
  if (!latest) return [];
  return getDb()
    .prepare(
      "SELECT * FROM defi_positions WHERE snapshot_id = ? AND wallet_id = ?"
    )
    .all(latest.snapshot_id, walletId) as DefiPosition[];
}

export function getLatestTokenBalances(walletId: number): TokenBalance[] {
  const latest = getDb()
    .prepare(
      `SELECT snapshot_id FROM wallet_snapshots WHERE wallet_id = ? ORDER BY snapshot_id DESC LIMIT 1`
    )
    .get(walletId) as { snapshot_id: number } | undefined;
  if (!latest) return [];
  return getDb()
    .prepare(
      "SELECT * FROM token_balances WHERE snapshot_id = ? AND wallet_id = ?"
    )
    .all(latest.snapshot_id, walletId) as TokenBalance[];
}
