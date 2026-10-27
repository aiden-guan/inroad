import { z } from "zod";
import { readAutomation } from "@/lib/automation/store";
import { canonicalUrl } from "@/lib/search/quality";
import { attributeAccount } from "@/lib/search/research";
import { normalizeDomain, isSuppressed } from "@/lib/hub/records";
import { mutateWorkspace } from "@/lib/store/workspace";
import { errorResponse, readJSON } from "@/lib/server/http";
const Body = z.object({
  receiptId: z.string().uuid(),
  url: z.string().max(2000),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).default(""),
});
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const url = canonicalUrl(body.url),
      domain = url ? normalizeDomain(url) : null;
    const receipt = readAutomation().receipts.find((r) => r.id === body.receiptId && r.kind === "research");
    if (!url || !domain || !receipt?.sourceUrls?.some((u) => canonicalUrl(u) === url))
      throw new Error("Choose a website from this research session's source results.");
    await mutateWorkspace((ws) => {
      if (domain === ws.company?.domain || isSuppressed(ws, undefined, domain)) throw new Error("This company is your own or is on the do-not-contact list.");
      if (!ws.accounts[domain])
        ws.accounts[domain] = {
          domain,
          name: body.name,
          oneLiner: body.description.slice(0, 200),
          status: "tracked",
          source: "web_search",
          sourceDetail: receipt.provider,
          sourceUrl: url,
          addedAt: new Date().toISOString(),
          fitScore: 0,
          tier: "C",
          criteria: [],
          signals: [],
          whyNow: null,
          whyNowScore: 0,
          peopleIds: [],
          warmPathCount: 0,
          watch: true,
        };
    });
    await attributeAccount(receipt.id, domain);
    return Response.json({ domain });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
