import { describe, expect, it } from "vitest";
import { automationTask, stopReadTasks } from "./tasks";
describe("workspace replacement", () => {
  it("aborts and drains external reads before allowing a replacement", async () => {
    let finished = false;
    const task = automationTask(undefined, async (signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      finished = true;
    });
    await Promise.resolve();
    await stopReadTasks();
    expect(finished).toBe(true);
    await task;
  });
});
