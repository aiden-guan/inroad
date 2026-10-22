import { describe, expect, it } from "vitest";
import { at, makeAccount, makeActivity, makePerson, makeWorkspace } from "@/test/factories";
import { referralBlock } from "./compose";

/** A first touch that rests on a referral cites the referrer's own words: from a reply, or from the call that named them. */
describe("referralBlock", () => {
  const ws = makeWorkspace();
  ws.accounts["northwind.example"] = makeAccount("northwind.example", { name: "Northwind" });
  const marcus = makePerson("per_marcus", "northwind.example", { name: "Marcus Lindqvist", title: "VP Finance" });
  const priya = makePerson("per_priya", "kestrel.example", { name: "Priya Shah" });

  it("quotes the call when the referral came from a debrief", () => {
    ws.activities.push(makeActivity("act_r", { at: at(-30), kind: "reply_received", personId: "per_marcus", body: "An old, unrelated reply." }));
    expect(referralBlock(ws, marcus, priya, "Talk to Priya at Kestrel, she rebuilt their close.")).toBe(
      '<referral>Marcus Lindqvist, VP Finance at Northwind, suggested you write to Priya Shah. Their words: "Talk to Priya at Kestrel, she rebuilt their close."</referral>',
    );
  });

  it("falls back to their latest reply", () => {
    expect(referralBlock(ws, marcus, priya)).toContain('Their words: "An old, unrelated reply."');
  });
});
