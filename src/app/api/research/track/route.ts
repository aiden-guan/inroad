import { z } from "zod";
import { readAutomation } from "@/lib/automation/store";
import { canonicalUrl } from "@/lib/search/quality";
import { attributeAccount } from "@/lib/search/research";
import { normalizeDomain, isSuppressed } from "@/lib/hub/records";
import { mutateWorkspace } from "@/lib/store/workspace";
import { errorResponse, readJSON } from "@/lib/server/http";
/** Hosts where each subdomain is its own site (acme.github.io is Acme's). */
const SHARED_HOSTS = /\.(github\.io|gitlab\.io|vercel\.app|netlify\.app|pages\.dev|herokuapp\.com|fly\.dev|webflow\.io|framer\.website|notion\.site|substack\.com|medium\.com|wordpress\.com|blogspot\.com|myshopify\.com|wixsite\.com|carrd\.co)$/;

/**
 * The company behind a page: blog.acme.com and app.acme.com are acme.com, shop.acme.co.uk is acme.co.uk, and on a
 * shared host the subdomain is the site. Tracking a subdomain must not make a second company keyed by it.
 */
function companyDomain(host: string): string {
  const parts = host.split(".");
  if (SHARED_HOSTS.test(host)) return parts.slice(-3).join(".");
  const countryCode = parts.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(parts.at(-2)!) && parts.at(-1)!.length === 2;
  return parts.slice(countryCode ? -3 : -2).join(".");
}

const titleCase = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

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
      host = url ? normalizeDomain(url) : null,
      domain = host ? companyDomain(host) : null;
    // A page title from a subdomain ("How we close | Acme Blog") isn't the company's name: start from the domain's,
    // which research replaces with the site's own name.
    const name = host && domain && host !== domain ? titleCase(domain.split(".")[0]) : body.name;
    const receipt = readAutomation().receipts.find((r) => r.id === body.receiptId && r.kind === "research");
    if (!url || !domain || !receipt?.sourceUrls?.some((u) => canonicalUrl(u) === url))
      throw new Error("Choose a website from this research session's source results.");
    await mutateWorkspace((ws) => {
      if (domain === ws.company?.domain || isSuppressed(ws, undefined, domain)) throw new Error("This company is your own or is on the do-not-contact list.");
      if (!ws.accounts[domain])
        ws.accounts[domain] = {
          domain,
          name,
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
