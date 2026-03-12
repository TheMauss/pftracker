/**
 * Next.js server instrumentation — registers the daily snapshot cron job.
 * Runs once when the server starts.
 */

export async function register() {
  // Only run in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Guard against duplicate registration on hot-reload in dev
  const g = global as typeof global & { _cronRegistered?: boolean };
  if (g._cronRegistered) return;
  g._cronRegistered = true;

  const cron = await import("node-cron");
  const { takeSnapshot } = await import("./lib/snapshot");

  // Daily at midnight Prague time
  cron.default.schedule(
    "0 0 * * *",
    async () => {
      console.log("[cron] Running midnight snapshot...");
      try {
        const result = await takeSnapshot();
        console.log(
          `[cron] Snapshot complete: id=${result.snapshotId}, $${result.totalUsd.toFixed(2)}, status=${result.status}`
        );
      } catch (err) {
        console.error("[cron] Snapshot failed:", err);
      }
    },
    { timezone: "Europe/Prague" }
  );

  console.log("[cron] Daily snapshot scheduled at midnight Europe/Prague");

  // Every 15 minutes — save arbitrage funding + price spread history
  cron.default.schedule("*/15 * * * *", async () => {
    try {
      const { fetchDeltaNeutralData, fetchPriceArbitrage } = await import("./lib/yields");
      await Promise.allSettled([fetchDeltaNeutralData(), fetchPriceArbitrage()]);
    } catch (err) {
      console.error("[cron] Arbitrage history save failed:", err);
    }
  });

  console.log("[cron] Arbitrage history scheduled every 15 minutes");
}
