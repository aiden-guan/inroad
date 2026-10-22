import { describe, expect, it } from "vitest";
import { tunnelTarget } from "./tunnel";

describe("tunnel target", () => {
  it("connects to the address the launcher listens on", () => {
    expect(tunnelTarget(undefined)).toBe("127.0.0.1");
    expect(tunnelTarget("127.0.0.1")).toBe("127.0.0.1");
    // Listening everywhere still answers on IPv4 loopback.
    expect(tunnelTarget("0.0.0.0")).toBe("127.0.0.1");
    expect(tunnelTarget("::")).toBe("[::1]");
    expect(tunnelTarget("::1")).toBe("[::1]");
    expect(tunnelTarget("fd00::5")).toBe("[fd00::5]");
    expect(tunnelTarget("localhost")).toBe("localhost");
    expect(tunnelTarget("10.0.0.4")).toBe("10.0.0.4");
  });
});
