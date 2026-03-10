/**
 * Standalone snapshot script — for Windows Task Scheduler.
 * Run: npx tsx scripts/take-snapshot.ts
 *
 * Windows Task Scheduler setup:
 * - Program: C:\path\to\node.exe
 * - Arguments: C:\path\to\npx tsx scripts/take-snapshot.ts
 * - Working directory: C:\Users\Marek\Desktop\Coding\Portfolio
 * - Schedule: Daily at 23:00 UTC (= midnight Prague CET) or 22:00 UTC (CEST)
 *
 * Alternatively, just let the Next.js server handle it via instrumentation.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

async function main() {
  console.log(`[snapshot-script] Starting at ${new Date().toISOString()}`);

  // Dynamic import after env is loaded
  const { takeSnapshot } = await import("../lib/snapshot");

  const result = await takeSnapshot();
  console.log(`[snapshot-script] Done:`, result);
  process.exit(0);
}

main().catch((err) => {
  console.error("[snapshot-script] Failed:", err);
  process.exit(1);
});
