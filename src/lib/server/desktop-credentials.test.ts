import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { keychainMode } = createRequire(import.meta.url)(
  "../../../desktop/app/credentials.cjs",
);
const mac = {
  packaged: true,
  platform: "darwin",
  executable: "/Applications/Inroad.app/Contents/MacOS/Inroad",
};

describe("desktop credential storage", () => {
  it("uses the encrypted store for ad hoc Mac builds, whose identity changes with updates", () => {
    const inspect = vi.fn(() => ({
      status: 0,
      stderr: "Signature=adhoc\nTeamIdentifier=not set\n",
    }));
    expect(keychainMode({ ...mac, inspect })).toBe("prefer-file");
    expect(inspect).toHaveBeenCalledWith(
      "/usr/bin/codesign",
      ["-dv", "--verbose=2", mac.executable],
      expect.objectContaining({ timeout: 3000 }),
    );
    expect(keychainMode({ ...mac, inspect: () => ({ status: 1 }) })).toBe(
      "prefer-file",
    );
    expect(
      keychainMode({
        ...mac,
        inspect: () => {
          throw new Error("unavailable");
        },
      }),
    ).toBe("prefer-file");
  });

  it("keeps Keychain for a Developer ID build and honors explicit configuration", () => {
    const inspect = vi.fn(() => ({
      status: 0,
      stderr: "Authority=Developer ID Application\nTeamIdentifier=ABCDE12345\n",
    }));
    expect(keychainMode({ ...mac, inspect })).toBeUndefined();
    inspect.mockClear();
    expect(keychainMode({ ...mac, inspect, configured: "off" })).toBe("off");
    expect(keychainMode({ ...mac, inspect, configured: "on" })).toBe("on");
    expect(keychainMode({ ...mac, inspect, packaged: false })).toBeUndefined();
    expect(
      keychainMode({ ...mac, inspect, platform: "linux" }),
    ).toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
  });
});
