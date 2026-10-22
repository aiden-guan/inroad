/**
 * Runs once when an Inroad server starts, before it answers requests (Next's instrumentation hook).
 * Node runtime only, and never during `next build`, which loads this file too.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { onServerStart } = await import("@/lib/server/startup");
  await onServerStart();
}
