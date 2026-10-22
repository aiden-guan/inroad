import { describe, expect, it } from "vitest";
import { movesHeading } from "./brief-data";

describe("movesHeading", () => {
  it("says 'While that runs' on day one only while discovery is looking", () => {
    expect(movesHeading({ dayOne: true, discovering: true })).toBe("While that runs");
    expect(movesHeading({ dayOne: true, discovering: false })).toBe("Or start here");
    expect(movesHeading({ dayOne: false, discovering: true })).toBe("Your moves");
    expect(movesHeading({ dayOne: false, discovering: false })).toBe("Your moves");
  });
});
