import type { LookupAddress } from "node:dns";
import type net from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJSON, fetchText, toDomain } from "./http";

/**
 * The SSRF guard, with DNS and the HTTP client stubbed: nothing here touches the network. A URL is
 * "fetched" when it reaches undici's fetch; the guard has to stop private targets before that, on
 * every redirect hop, and again when the socket resolves the host (DNS rebinding).
 */

const { lookup, dnsLookup, undiciFetch, agents } = vi.hoisted(() => ({
  lookup: vi.fn(),
  dnsLookup: vi.fn(),
  undiciFetch: vi.fn(),
  agents: [] as { options: { connect: { lookup: net.LookupFunction } } }[],
}));

vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));
vi.mock("node:dns", () => ({ lookup: dnsLookup, default: { lookup: dnsLookup } }));
vi.mock("undici", () => ({
  fetch: undiciFetch,
  Agent: class {
    constructor(readonly options: { connect: { lookup: net.LookupFunction } }) {
      agents.push(this);
    }
  },
}));

/** Names resolve to a public IP unless `hosts` says otherwise (a list of addresses, or a lookup error). */
function resolve(hosts: Record<string, string[] | Error> = {}) {
  lookup.mockImplementation(async (host: string) => {
    const hit = hosts[host];
    if (hit instanceof Error) throw hit;
    return (hit ?? ["93.184.216.34"]).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  });
}

const ok = (body = "hello") => new Response(body, { status: 200 });
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

/** The URLs that actually reached the HTTP client, in order. */
const fetched = () => undiciFetch.mock.calls.map(([url]) => url as string);

beforeEach(() => {
  lookup.mockReset();
  undiciFetch.mockReset();
  dnsLookup.mockReset();
  resolve();
  undiciFetch.mockImplementation(async () => ok());
});

describe("fetchText SSRF guard", () => {
  it.each([
    "http://127.0.0.1/",
    "http://127.8.9.10/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://192.0.0.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
    "http://2130706433/", // 127.0.0.1 as a single number
    "http://0x7f.1/", // 127.0.0.1 in hex shorthand
  ])("blocks the private or reserved IPv4 address %s", async (url) => {
    expect(await fetchText(url)).toBeNull();
    expect(undiciFetch).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    "http://[::1]/",
    "http://[::]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:127.0.0.1]/", // IPv4-mapped loopback
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[64:ff9b::a00:1]/", // NAT64 of 10.0.0.1
    "http://[2002:7f00:1::1]/", // 6to4 of 127.0.0.1
    "http://[::127.0.0.1]/", // IPv4-compatible
  ])("blocks the private, mapped or translated IPv6 address %s", async (url) => {
    expect(await fetchText(url)).toBeNull();
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it("allows public IP literals without a DNS lookup", async () => {
    expect(await fetchText("http://93.184.216.34/")).toMatchObject({ status: 200, body: "hello" });
    expect(await fetchText("https://[2606:4700:4700::1111]/")).toMatchObject({ status: 200 });
    expect(lookup).not.toHaveBeenCalled();
    expect(fetched()).toEqual(["http://93.184.216.34/", "https://[2606:4700:4700::1111]/"]);
  });

  it.each(["http://localhost/", "http://LOCALHOST:80/", "http://app.localhost/", "http://printer.local/", "http://db.internal/", "http://router.lan/", "http://nas.home/", "http://wiki.corp/", "http://acme.example/", "http://acme.test/", "http://acme.invalid/"])(
    "blocks the local or reserved name %s without resolving it",
    async (url) => {
      expect(await fetchText(url)).toBeNull();
      expect(lookup).not.toHaveBeenCalled();
      expect(undiciFetch).not.toHaveBeenCalled();
    },
  );

  it.each(["ftp://acme.com/file", "file:///etc/passwd", "gopher://acme.com/", "http://user:pass@acme.com/", "http://user@acme.com/", "https://acme.com:8443/", "http://acme.com:22/", "not a url"])(
    "blocks %s (scheme, credentials or port)",
    async (url) => {
      expect(await fetchText(url)).toBeNull();
      expect(undiciFetch).not.toHaveBeenCalled();
    },
  );

  it("allows the default ports when spelled out", async () => {
    await fetchText("http://acme.com:80/");
    await fetchText("https://acme.com:443/");
    expect(fetched()).toEqual(["http://acme.com:80/", "https://acme.com:443/"]);
  });

  it("blocks a name that resolves to a private address, even alongside a public one", async () => {
    resolve({ "rebind.acme.com": ["10.0.0.7"], "mixed.acme.com": ["93.184.216.34", "127.0.0.1"], "mapped.acme.com": ["::ffff:192.168.0.1"], "none.acme.com": [], "nxdomain.acme.com": new Error("ENOTFOUND") });
    for (const host of ["rebind", "mixed", "mapped", "none", "nxdomain"]) expect(await fetchText(`https://${host}.acme.com/`)).toBeNull();
    expect(undiciFetch).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledWith("rebind.acme.com", { all: true });
  });

  it("fetches public names without following redirects on its own, through the guarded dispatcher", async () => {
    expect(await fetchText("https://acme.com/about")).toEqual({ url: "https://acme.com/about", status: 200, body: "hello" });
    const [, init] = undiciFetch.mock.calls[0];
    expect(init).toMatchObject({ redirect: "manual", headers: { Accept: "text/html,application/xhtml+xml" } });
    expect(init.dispatcher).toBe(agents[0]);
  });
});

describe("fetchText redirects", () => {
  it("checks every hop and stops at a private target", async () => {
    undiciFetch.mockResolvedValueOnce(redirect("http://127.0.0.1:80/admin"));
    expect(await fetchText("https://acme.com/")).toBeNull();
    expect(fetched()).toEqual(["https://acme.com/"]);
  });

  it("stops at a hop whose name resolves privately", async () => {
    resolve({ "internal.acme.com": ["192.168.4.4"] });
    undiciFetch.mockResolvedValueOnce(redirect("https://internal.acme.com/"));
    expect(await fetchText("https://acme.com/")).toBeNull();
    expect(fetched()).toEqual(["https://acme.com/"]);
  });

  it("follows relative and absolute public redirects and reports the final URL", async () => {
    undiciFetch.mockResolvedValueOnce(redirect("/pricing", 301)).mockResolvedValueOnce(redirect("https://www.acme.com/pricing", 308));
    expect(await fetchText("https://acme.com/")).toEqual({ url: "https://www.acme.com/pricing", status: 200, body: "hello" });
    expect(fetched()).toEqual(["https://acme.com/", "https://acme.com/pricing", "https://www.acme.com/pricing"]);
  });

  it("gives up after six hops", async () => {
    undiciFetch.mockImplementation(async (url: string) => redirect(`${url}x`));
    expect(await fetchText("https://acme.com/")).toBeNull();
    expect(undiciFetch).toHaveBeenCalledTimes(6);
  });
});

describe("fetchText responses", () => {
  it("returns null for errors and failed requests", async () => {
    undiciFetch.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    expect(await fetchText("https://acme.com/missing")).toBeNull();
    undiciFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await fetchText("https://acme.com/")).toBeNull();
  });

  it("stops reading past the size cap", async () => {
    const chunk = new Uint8Array(10).fill(97);
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++pulls > 5) controller.close();
        else controller.enqueue(chunk);
      },
    });
    undiciFetch.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const res = await fetchText("https://acme.com/big", { maxBytes: 15 });
    expect(res?.body).toBe("a".repeat(20));
  });

  it("parses JSON, and returns null for anything that isn't", async () => {
    undiciFetch.mockResolvedValueOnce(ok('{"jobs":[1]}')).mockResolvedValueOnce(ok("<html>"));
    expect(await fetchJSON("https://acme.com/a.json")).toEqual({ jobs: [1] });
    expect(await fetchJSON("https://acme.com/b.json")).toBeNull();
    expect(undiciFetch.mock.calls[0][1].headers.Accept).toBe("application/json");
  });
});

describe("connect-time lookup (DNS rebinding)", () => {
  const connectLookup = (host: string, options: { all?: boolean } = {}) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }>((done) => {
      agents[0].options.connect.lookup(host, options as never, ((err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) =>
        done({ err, address, family })) as never);
    });
  const answer = (addresses: LookupAddress[] | Error) =>
    dnsLookup.mockImplementation((_host: string, _opts: unknown, cb: (err: Error | null, addresses: LookupAddress[]) => void) =>
      addresses instanceof Error ? cb(addresses, []) : cb(null, addresses),
    );

  it("refuses a host that resolves to a private address at connect time", async () => {
    answer([{ address: "127.0.0.1", family: 4 }]);
    const r = await connectLookup("rebind.acme.com");
    expect(r.err).toMatchObject({ code: "EADDRNOTAVAIL", message: "rebind.acme.com resolves to a private address" });
    expect(dnsLookup).toHaveBeenCalledWith("rebind.acme.com", { all: true }, expect.any(Function));
  });

  it("refuses when any address is private, or none came back", async () => {
    answer([
      { address: "93.184.216.34", family: 4 },
      { address: "::ffff:10.0.0.1", family: 6 },
    ]);
    expect((await connectLookup("mixed.acme.com")).err?.code).toBe("EADDRNOTAVAIL");
    answer([]);
    expect((await connectLookup("empty.acme.com")).err?.code).toBe("EADDRNOTAVAIL");
  });

  it("passes public answers through in the shape the socket asked for", async () => {
    const addresses = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::248", family: 6 },
    ];
    answer(addresses);
    expect(await connectLookup("acme.com")).toEqual({ err: null, address: "93.184.216.34", family: 4 });
    expect(await connectLookup("acme.com", { all: true })).toEqual({ err: null, address: addresses, family: undefined });
  });

  it("passes DNS errors through", async () => {
    answer(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    expect((await connectLookup("nxdomain.acme.com")).err?.code).toBe("ENOTFOUND");
  });
});

describe("toDomain", () => {
  it("normalizes what founders paste", () => {
    expect(["Acme.com", "https://www.acme.com/about", "  acme.com/pricing?x=1 ", "http://sub.acme.co.uk", "localhost", "", "https://"].map(toDomain)).toEqual([
      "acme.com",
      "acme.com",
      "acme.com",
      "sub.acme.co.uk",
      null,
      null,
      null,
    ]);
  });
});
