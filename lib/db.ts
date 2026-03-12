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

    CREATE TABLE IF NOT EXISTS stock_positions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source      TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      name        TEXT,
      quantity    REAL NOT NULL,
      avg_price   REAL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Price arbitrage history (spread tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_arb_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      asset      TEXT NOT NULL,
      hl_price   REAL NOT NULL,
      lt_price   REAL NOT NULL,
      spread_pct REAL NOT NULL,
      net_pct    REAL NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_price_arb_history_lookup
      ON price_arb_history(asset, fetched_at);
  `);

  // Funding rate history (for arbitrage trend tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS funding_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      asset      TEXT NOT NULL,
      venue      TEXT NOT NULL,
      rate_8h    REAL NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_funding_history_lookup
      ON funding_history(asset, venue, fetched_at);
  `);

  // Incremental migrations
  try { db.exec(`ALTER TABLE stock_positions ADD COLUMN price_usd REAL`); } catch {}
  try { db.exec(`ALTER TABLE stock_positions ADD COLUMN category TEXT NOT NULL DEFAULT 'Akcie'`); } catch {}

  // Migration version tracking
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)`);

  // v2: clear old snapshots that didn't include stock values
  const hasV2 = db.prepare("SELECT 1 FROM schema_migrations WHERE version = 'v2_include_stocks'").get();
  if (!hasV2) {
    db.exec(`
      DELETE FROM defi_positions;
      DELETE FROM token_balances;
      DELETE FROM wallet_snapshots;
      DELETE FROM snapshots;
    `);
    db.prepare("INSERT INTO schema_migrations (version) VALUES ('v2_include_stocks')").run();
    console.log("[db] Migration v2: cleared old snapshots (stocks not included in totals)");
  }
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

// ─── Stock positions ──────────────────────────────────────────────────────────

export interface StockPosition {
  id: number;
  source: string;
  ticker: string;
  name: string | null;
  quantity: number;
  avg_price: number | null;
  price_usd: number | null;
  category: string;
  imported_at: string;
}

export function getStockPositions(): StockPosition[] {
  return getDb().prepare("SELECT * FROM stock_positions ORDER BY ticker ASC").all() as StockPosition[];
}

export function upsertStockPositions(positions: Omit<StockPosition, "id" | "imported_at">[]): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM stock_positions WHERE source = ?");
  const ins = db.prepare("INSERT INTO stock_positions (source, ticker, name, quantity, avg_price) VALUES (?, ?, ?, ?, ?)");
  const sources = [...new Set(positions.map((p) => p.source))];
  const run = db.transaction(() => {
    for (const src of sources) del.run(src);
    for (const p of positions) ins.run(p.source, p.ticker, p.name ?? null, p.quantity, p.avg_price ?? null);
  });
  run();
}

export function deleteStockSource(source: string): void {
  getDb().prepare("DELETE FROM stock_positions WHERE source = ?").run(source);
}

export function insertManualPosition(ticker: string, quantity: number, avg_price: number | null, name: string | null, price_usd: number | null = null, category = "Akcie"): number {
  const result = getDb()
    .prepare("INSERT INTO stock_positions (source, ticker, name, quantity, avg_price, price_usd, category) VALUES ('manual', ?, ?, ?, ?, ?, ?)")
    .run(ticker.toUpperCase().trim(), name ?? null, quantity, avg_price ?? null, price_usd ?? null, category);
  return result.lastInsertRowid as number;
}

export function updateStockPosition(id: number, fields: Partial<Pick<StockPosition, "ticker" | "name" | "quantity" | "avg_price" | "price_usd" | "category">>): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.ticker    !== undefined) { sets.push("ticker = ?");    vals.push(fields.ticker.toUpperCase().trim()); }
  if (fields.name      !== undefined) { sets.push("name = ?");      vals.push(fields.name); }
  if (fields.quantity  !== undefined) { sets.push("quantity = ?");  vals.push(fields.quantity); }
  if (fields.avg_price !== undefined) { sets.push("avg_price = ?"); vals.push(fields.avg_price); }
  if (fields.price_usd !== undefined) { sets.push("price_usd = ?"); vals.push(fields.price_usd); }
  if (fields.category  !== undefined) { sets.push("category = ?");  vals.push(fields.category); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE stock_positions SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as any[]));
}

export function deleteStockPosition(id: number): void {
  getDb().prepare("DELETE FROM stock_positions WHERE id = ?").run(id);
}

// ─── Funding rate history (arbitrage) ────────────────────────────────────────

export interface FundingRecord {
  asset: string;
  venue: string;  // "hyperliquid" | "lighter"
  rate_8h: number;
  fetched_at: string;
}

/** Save a batch of funding records. Call at most once per ~15 min via shouldSaveFunding(). */
export function saveFundingHistory(records: FundingRecord[]): void {
  if (!records.length) return;
  const db = getDb();
  const ins = db.prepare(
    "INSERT INTO funding_history (asset, venue, rate_8h, fetched_at) VALUES (?, ?, ?, ?)"
  );
  db.transaction(() => {
    for (const r of records) ins.run(r.asset, r.venue, r.rate_8h, r.fetched_at);
  })();
}

/** Returns true if no record exists within the last `minIntervalMs` ms. */
export function shouldSaveFunding(minIntervalMs = 15 * 60_000): boolean {
  const row = getDb()
    .prepare("SELECT MAX(fetched_at) as latest FROM funding_history")
    .get() as { latest: string | null };
  if (!row.latest) return true;
  return Date.now() - new Date(row.latest).getTime() > minIntervalMs;
}

/** Get rate closest to `targetIso` (within ±2 hours) for a given asset + venue. */
export function getFundingNear(
  asset: string,
  venue: string,
  targetIso: string
): number | null {
  const row = getDb()
    .prepare(
      `SELECT rate_8h FROM funding_history
       WHERE asset = ? AND venue = ?
         AND fetched_at >= datetime(?, '-2 hours')
         AND fetched_at <= datetime(?, '+2 hours')
       ORDER BY ABS(strftime('%s', fetched_at) - strftime('%s', ?))
       LIMIT 1`
    )
    .get(asset, venue, targetIso, targetIso, targetIso) as
    | { rate_8h: number }
    | undefined;
  return row?.rate_8h ?? null;
}

export interface FundingHistoryPoint {
  fetched_at: string;
  hl_rate: number | null;
  lighter_rate: number | null;
}

/** Return all (asset, hl, lighter) pairs for the last `hoursBack` hours, one row per timestamp. */
export function getFundingHistory(
  asset: string,
  hoursBack: number
): FundingHistoryPoint[] {
  const cutoff = new Date(Date.now() - hoursBack * 3_600_000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT fetched_at, venue, rate_8h FROM funding_history
       WHERE asset = ? AND fetched_at >= ?
       ORDER BY fetched_at ASC`
    )
    .all(asset, cutoff) as { fetched_at: string; venue: string; rate_8h: number }[];

  // Merge HL + Lighter rows that share the same fetched_at timestamp
  const map = new Map<string, { hl: number | null; lighter: number | null }>();
  for (const row of rows) {
    if (!map.has(row.fetched_at)) map.set(row.fetched_at, { hl: null, lighter: null });
    const entry = map.get(row.fetched_at)!;
    if (row.venue === "hyperliquid") entry.hl = row.rate_8h;
    else if (row.venue === "lighter") entry.lighter = row.rate_8h;
  }
  return Array.from(map.entries()).map(([fetched_at, r]) => ({
    fetched_at,
    hl_rate: r.hl,
    lighter_rate: r.lighter,
  }));
}

// ─── Price arbitrage history ──────────────────────────────────────────────────

export interface PriceArbRecord {
  asset: string;
  hl_price: number;
  lt_price: number;
  spread_pct: number;
  net_pct: number;
  fetched_at: string;
}

export function savePriceArbHistory(records: PriceArbRecord[]): void {
  if (!records.length) return;
  const db = getDb();
  const ins = db.prepare(
    "INSERT INTO price_arb_history (asset, hl_price, lt_price, spread_pct, net_pct, fetched_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  db.transaction(() => {
    for (const r of records) ins.run(r.asset, r.hl_price, r.lt_price, r.spread_pct, r.net_pct, r.fetched_at);
  })();
}

export function shouldSavePriceArb(minIntervalMs = 15 * 60_000): boolean {
  const row = getDb()
    .prepare("SELECT MAX(fetched_at) as latest FROM price_arb_history")
    .get() as { latest: string | null };
  if (!row.latest) return true;
  return Date.now() - new Date(row.latest).getTime() > minIntervalMs;
}

export interface PriceArbHistoryPoint {
  fetched_at: string;
  hl_price: number;
  lt_price: number;
  spread_pct: number;
  net_pct: number;
}

export function getPriceArbHistory(asset: string, hoursBack: number): PriceArbHistoryPoint[] {
  const cutoff = new Date(Date.now() - hoursBack * 3_600_000).toISOString();
  return getDb()
    .prepare(
      `SELECT fetched_at, hl_price, lt_price, spread_pct, net_pct
       FROM price_arb_history
       WHERE asset = ? AND fetched_at >= ?
       ORDER BY fetched_at ASC`
    )
    .all(asset, cutoff) as PriceArbHistoryPoint[];
}
