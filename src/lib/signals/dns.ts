import "server-only";
import { fetchJSON } from "./http";

/**
 * Free DNS-over-HTTPS lookups. MX reveals the email provider, SPF/DMARC show sending health
 * (used for the founder's own domain), and TXT verification tokens reveal a company's SaaS stack.
 */

interface DohResponse {
  Status: number;
  Answer?: { name: string; type: number; data: string }[];
}

async function resolve(name: string, type: "MX" | "TXT"): Promise<string[]> {
  const data = await fetchJSON<DohResponse>(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, 6000);
  return (data?.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, "").replace(/" "/g, ""));
}

const VERIFICATION_TOKENS: [string, RegExp][] = [
  ["HubSpot", /hubspot/i],
  ["Salesforce", /salesforce|pardot/i],
  ["Atlassian", /atlassian/i],
  ["Slack", /slack-domain/i],
  ["Notion", /notion/i],
  ["Linear", /linear-domain/i],
  ["Zoom", /zoom/i],
  ["OpenAI", /openai/i],
  ["Anthropic", /anthropic/i],
  ["Cursor", /cursor/i],
  ["Segment", /segment/i],
  ["Stripe", /stripe/i],
  ["1Password", /1password/i],
  ["Docusign", /docusign/i],
  ["Adobe", /adobe-idp|adobe-sign/i],
  ["Miro", /miro/i],
  ["Figma", /figma/i],
  ["Gong", /gong/i],
  ["Apollo", /apollo/i],
  ["Outreach", /outreach/i],
  ["Zendesk", /zendesk/i],
  ["Intercom", /intercom/i],
  ["Okta", /okta/i],
  ["Vanta", /vanta/i],
  ["Drata", /drata/i],
  ["Mailchimp", /mailchimp|mandrill/i],
  ["SendGrid", /sendgrid/i],
  ["Amazon SES", /amazonses/i],
  ["Customer.io", /customerio|customer\.io/i],
];

export interface DnsProfile {
  emailProvider: "google" | "microsoft" | "other" | "none";
  mx: string[];
  spf: string | null;
  dmarc: string | null;
  saas: string[];
}

export async function dnsProfile(domain: string): Promise<DnsProfile> {
  const [mx, txt, dmarcTxt] = await Promise.all([resolve(domain, "MX"), resolve(domain, "TXT"), resolve(`_dmarc.${domain}`, "TXT")]);
  const mxHosts = mx.map((m) => m.split(" ").pop() ?? m).map((h) => h.replace(/\.$/, "").toLowerCase());
  const emailProvider = !mxHosts.length
    ? "none"
    : mxHosts.some((h) => h.includes("google") || h.includes("googlemail"))
      ? "google"
      : mxHosts.some((h) => h.includes("outlook") || h.includes("microsoft"))
        ? "microsoft"
        : "other";
  const spf = txt.find((t) => t.toLowerCase().startsWith("v=spf1")) ?? null;
  const dmarc = dmarcTxt.find((t) => t.toLowerCase().startsWith("v=dmarc1")) ?? null;
  const saas = [
    ...new Set([
      ...VERIFICATION_TOKENS.filter(([, re]) => txt.some((t) => re.test(t))).map(([n]) => n),
      ...VERIFICATION_TOKENS.filter(([, re]) => spf && re.test(spf)).map(([n]) => n),
    ]),
  ];
  return { emailProvider, mx: mxHosts, spf, dmarc, saas };
}
