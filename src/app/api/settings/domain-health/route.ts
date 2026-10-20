import { z } from "zod";
import type { DomainCheck, DomainHealthReport } from "@/components/settings/types";
import { applyAction } from "@/lib/domain/actions";
import { monthKey, nowISO } from "@/lib/domain/ids";
import { errorResponse, readJSON } from "@/lib/server/http";
import { dnsProfile, type DnsProfile } from "@/lib/signals/dns";
import { fetchJSON, toDomain } from "@/lib/signals/http";
import { mutateWorkspace } from "@/lib/store/workspace";

/**
 * Sending-domain health from public DNS (free, no tokens): MX, SPF, DKIM and DMARC — what Gmail,
 * Yahoo and Microsoft check before they trust mail from the founder's domain.
 * Rules: support.google.com/a/answer/81126 (all senders), /answer/14229414 (bulk), RFC 7208 §4.6.4 (SPF ≤10 lookups).
 */

const Body = z.object({ domain: z.string().min(1).max(253) });

interface Doh {
  Status: number;
  Answer?: { type: number; data: string }[];
}

const TXT_TYPE = 16;
const unquote = (s: string) => s.replace(/^"|"$/g, "").replace(/" "/g, "");

async function txt(name: string): Promise<{ status: number | null; records: string[] }> {
  const data = await fetchJSON<Doh>(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`, 6000);
  if (!data) return { status: null, records: [] };
  return { status: data.Status, records: (data.Answer ?? []).filter((a) => a.type === TXT_TYPE).map((a) => unquote(a.data)) };
}

/** DKIM lives under a selector the provider picks; these cover Google, Microsoft and most ESPs. */
const DKIM_SELECTORS: Record<DnsProfile["emailProvider"], string[]> = {
  google: ["google"],
  microsoft: ["selector1", "selector2"],
  other: [],
  none: [],
};
const COMMON_SELECTORS = ["google", "selector1", "selector2", "default", "k1", "s1", "s2", "dkim", "mail"];

async function findDkim(domain: string, provider: DnsProfile["emailProvider"]): Promise<{ selector: string | null; tried: number }> {
  const selectors = [...new Set([...DKIM_SELECTORS[provider], ...COMMON_SELECTORS])];
  const results = await Promise.all(
    selectors.map(async (s) => {
      const { records } = await txt(`${s}._domainkey.${domain}`);
      // An empty p= means the key was revoked.
      return records.some((r) => /\bp=[A-Za-z0-9+/]/.test(r)) ? s : null;
    }),
  );
  return { selector: results.find(Boolean) ?? null, tried: selectors.length };
}

const PROVIDER_NAME: Record<DnsProfile["emailProvider"], string> = {
  google: "Google Workspace",
  microsoft: "Microsoft 365",
  other: "your email provider",
  none: "your email provider",
};

const SPF_INCLUDE: Partial<Record<DnsProfile["emailProvider"], { include: string; record: string }>> = {
  google: { include: "_spf.google.com", record: "v=spf1 include:_spf.google.com ~all" },
  microsoft: { include: "spf.protection.outlook.com", record: "v=spf1 include:spf.protection.outlook.com -all" },
};

function mxCheck(domain: string, p: DnsProfile): DomainCheck {
  const hosts = p.mx.filter(Boolean);
  if (p.mx.length && !hosts.length) {
    // RFC 7505 "null MX" (`0 .`): the domain declares it accepts no mail at all.
    return {
      id: "mx",
      label: "Mail servers (MX)",
      status: "fail",
      summary: `${domain} declares that it accepts no mail, so replies would bounce.`,
      fix: "Send from a domain with a real mailbox, or replace the null MX with your provider's MX records.",
    };
  }
  if (!hosts.length) {
    return {
      id: "mx",
      label: "Mail servers (MX)",
      status: "fail",
      summary: `${domain} has no mail servers, so replies to your address can't arrive.`,
      fix: "Add the MX records your email provider gives you during setup. Receivers also distrust mail from a domain that can't receive any.",
    };
  }
  return {
    id: "mx",
    label: "Mail servers (MX)",
    status: "pass",
    summary: p.emailProvider === "other" ? `Mail for ${domain} goes to ${hosts[0]}.` : `Mail for ${domain} runs on ${PROVIDER_NAME[p.emailProvider]}.`,
    found: hosts.slice(0, 3).join(", "),
  };
}

const SPF = /^v=spf1(\s|$)/i;

interface SpfWalk {
  /** DNS-querying mechanisms across the record and its includes (RFC 7208 §4.6.4 caps this at 10). */
  lookups: number;
  /** Every include:/redirect= domain reached, nested ones too. */
  includes: Set<string>;
  /** TXT queries the walk made. */
  queries: number;
  /** True when the walk stopped early, so `lookups` is a floor. */
  partial: boolean;
}

/** Follows include: and redirect= (3 levels, 12 queries at most) to count lookups and find provider includes. */
async function walkSpf(record: string): Promise<SpfWalk> {
  const walk: SpfWalk = { lookups: 0, includes: new Set(), queries: 0, partial: false };
  const visit = async (rec: string, depth: number): Promise<void> => {
    const nested: string[] = [];
    for (const term of rec.split(/\s+/)) {
      const t = term.replace(/^[+\-~?]/, "").toLowerCase();
      const target = t.match(/^(?:include:|redirect=)(.+)$/)?.[1];
      if (target) {
        walk.lookups++;
        walk.includes.add(target);
        nested.push(target);
      } else if (/^(a|mx|ptr)($|[:/])/.test(t) || t.startsWith("exists:")) {
        walk.lookups++;
      }
    }
    if (!nested.length) return;
    if (depth >= 3) {
      walk.partial = true;
      return;
    }
    await Promise.all(
      nested.map(async (d) => {
        if (walk.queries >= 12) {
          walk.partial = true;
          return;
        }
        walk.queries++;
        const next = (await txt(d)).records.find((r) => SPF.test(r));
        if (next) await visit(next, depth + 1);
      }),
    );
  };
  await visit(record, 0);
  return walk;
}

function spfCheck(domain: string, p: DnsProfile, records: string[], walk: SpfWalk | null): DomainCheck {
  const label = "SPF";
  const suggested = SPF_INCLUDE[p.emailProvider];
  if (!records.length) {
    return {
      id: "spf",
      label,
      status: "fail",
      summary: `No SPF record, so receivers can't confirm which servers may send mail for ${domain}.`,
      fix: suggested ? "Add this TXT record at the root of your domain." : "Add a TXT record at the root of your domain with your email provider's include. Their setup guide names it.",
      record: { host: "@", type: "TXT", value: suggested?.record ?? "v=spf1 include:<your provider> ~all" },
    };
  }
  if (records.length > 1) {
    return {
      id: "spf",
      label,
      status: "fail",
      summary: `${records.length} SPF records. Receivers treat two as an error, so SPF fails for every message.`,
      fix: "Merge them into one record that keeps every include: and ends with a single ~all.",
      found: records.join("\n"),
    };
  }
  const record = records[0];
  const all = record.match(/\s([+\-~?]?)all\s*$/i);
  const lookups = walk?.lookups ?? 0;
  if (all?.[1] === "+") {
    return { id: "spf", label, status: "fail", summary: "Your SPF record ends in +all, which lets anyone send mail as you.", fix: "Change +all to ~all.", found: record };
  }
  if (lookups > 10) {
    return {
      id: "spf",
      label,
      status: "fail",
      summary: `Your SPF record needs ${walk?.partial ? "at least " : ""}${lookups} DNS lookups. The limit is 10, so receivers treat it as an error.`,
      fix: "Remove includes for tools you no longer send from, or ask your provider for a flattened record.",
      found: record,
    };
  }
  if (suggested && !walk?.includes.has(suggested.include) && !walk?.partial) {
    return {
      id: "spf",
      label,
      status: "warn",
      summary: `Your mail runs on ${PROVIDER_NAME[p.emailProvider]}, but SPF doesn't list its servers.`,
      fix: `Add include:${suggested.include} before the final all.`,
      found: record,
    };
  }
  // A redirect= hands the decision to another record, which carries its own all.
  if ((!all || all[1] === "?") && !/\sredirect=/i.test(record)) {
    return {
      id: "spf",
      label,
      status: "warn",
      summary: "Your SPF record doesn't say what to do with mail from other servers, so it protects little.",
      fix: "End the record with ~all.",
      found: record,
    };
  }
  return { id: "spf", label, status: "pass", summary: `SPF lists who may send for ${domain}${all ? ` and ends in ${all[1] || ""}all` : ""}, within the 10-lookup limit.`, found: record };
}

function dkimCheck(domain: string, p: DnsProfile, selector: string | null): DomainCheck {
  if (selector) {
    return { id: "dkim", label: "DKIM", status: "pass", summary: "Your mail is signed. I found a published DKIM key.", found: `${selector}._domainkey.${domain}` };
  }
  const fix =
    p.emailProvider === "google"
      ? "In the Google Admin console, open Apps → Google Workspace → Gmail → Authenticate email. Generate a 2048-bit key, publish the TXT record it shows, then press Start authentication."
      : p.emailProvider === "microsoft"
        ? "In Microsoft Defender, open Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM. Publish the two CNAME records it shows, then turn on signing."
        : "Your email provider's admin settings have a DKIM or email authentication page. Publish the record it gives you.";
  return {
    id: "dkim",
    label: "DKIM",
    status: "warn",
    summary: "I couldn't find a DKIM key under the usual names. If you set one up with a custom selector, this is fine.",
    fix,
  };
}

function dmarcCheck(domain: string, p: DnsProfile): DomainCheck {
  const label = "DMARC";
  if (!p.dmarc) {
    return {
      id: "dmarc",
      label,
      status: "fail",
      summary: `No DMARC record. Gmail, Yahoo and Microsoft use it to decide whether mail from ${domain} is really yours.`,
      fix: "Start in monitoring mode (p=none). It changes nothing about delivery today. Point rua at a mailbox you read, or drop that part.",
      record: { host: "_dmarc", type: "TXT", value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}` },
    };
  }
  const policy = p.dmarc.match(/\bp\s*=\s*(none|quarantine|reject)\b/i)?.[1]?.toLowerCase();
  if (!policy) {
    return { id: "dmarc", label, status: "warn", summary: "Your DMARC record has no policy, so receivers ignore it.", fix: "Add p=none right after v=DMARC1;", found: p.dmarc };
  }
  return {
    id: "dmarc",
    label,
    status: "pass",
    summary:
      policy === "none"
        ? "DMARC is on in monitoring mode (p=none), which meets the Gmail and Yahoo rules. Once reports show only your own senders, move to p=quarantine."
        : `DMARC is enforced (p=${policy}).`,
    found: p.dmarc,
  };
}

export async function POST(request: Request) {
  try {
    const { domain: raw } = Body.parse(await readJSON(request));
    const domain = toDomain(raw.includes("@") ? raw.split("@").pop()! : raw);
    if (!domain) return Response.json({ error: "Enter a domain like acme.com." }, { status: 400 });

    const [profile, root] = await Promise.all([dnsProfile(domain), txt(domain)]);
    if (root.status === null && !profile.mx.length && !profile.spf && !profile.dmarc) {
      return Response.json({ error: "I couldn't reach the DNS resolver. Check your connection and try again." }, { status: 502 });
    }
    if (root.status === 3) {
      return Response.json({ error: `${domain} doesn't exist in DNS. Check the spelling.` }, { status: 400 });
    }
    const spfRecords = root.records.filter((r) => SPF.test(r));
    const [dkim, walk] = await Promise.all([findDkim(domain, profile.emailProvider), spfRecords.length === 1 ? walkSpf(spfRecords[0]) : null]);

    const checks = [mxCheck(domain, profile), spfCheck(domain, profile, spfRecords, walk), dkimCheck(domain, profile, dkim.selector), dmarcCheck(domain, profile)];
    const checkedAt = nowISO();
    const lookups = 4 + dkim.tried + (walk?.queries ?? 0);
    const report: DomainHealthReport = { domain, provider: profile.emailProvider, checks, checkedAt, lookups };

    const spf = checks.find((c) => c.id === "spf")!;
    await mutateWorkspace((ws) => {
      applyAction(ws, {
        type: "sender.update",
        patch: {
          sendingDomain: domain,
          domainHealth: { spf: spf.status !== "fail", dkim: dkim.selector ? true : null, dmarc: profile.dmarc, mx: profile.mx.find(Boolean) ?? "", checkedAt },
        },
      });
      const key = monthKey();
      ws.usage[key] ??= { costUsd: 0, runs: 0, byWorkflow: {}, freeSignals: 0 };
      ws.usage[key].freeSignals += lookups;
    });

    return Response.json(report);
  } catch (err) {
    return errorResponse(err);
  }
}
