import { describe, expect, it } from "vitest";
import { shouldMoveFocus, startFocus } from "./focus";

describe("startFocus", () => {
  const base = { needsKey: false, keySaved: false, mode: "site" as const, unreachable: false };

  it("starts on the key box when there's no key, since it sits above the website", () => {
    expect(startFocus({ ...base, needsKey: true })).toBe("key");
    expect(startFocus({ ...base, needsKey: true, mode: "describe" })).toBe("key");
  });

  it("starts on the website once a key exists or was just saved", () => {
    expect(startFocus(base)).toBe("site");
    expect(startFocus({ ...base, needsKey: true, keySaved: true })).toBe("site");
  });

  it("asks for the sentence when the site couldn't be read, or in describe mode", () => {
    expect(startFocus({ ...base, unreachable: true })).toBe("note");
    expect(startFocus({ ...base, mode: "describe" })).toBe("describe");
  });
});

describe("shouldMoveFocus", () => {
  it("takes the cursor from an untouched, autofocused field", () => {
    expect(shouldMoveFocus({ id: "site", value: "" }, "key")).toBe(true);
    expect(shouldMoveFocus(null, "key")).toBe(true);
  });

  it("never pulls the cursor out from under someone typing", () => {
    expect(shouldMoveFocus({ id: "site", value: "acme.com" }, "key")).toBe(false);
    expect(shouldMoveFocus({ id: "anthropic-key", value: "" }, "key")).toBe(false);
    expect(shouldMoveFocus({ id: "some-other-control", value: "" }, "key")).toBe(false);
    // A button the founder just pressed ("No website yet?") has no id: leave it be.
    expect(shouldMoveFocus({ id: "", value: "" }, "key")).toBe(false);
  });
});
