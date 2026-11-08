# Running Inroad day to day

Inroad is a single-user app that runs on your own computer, and it is built that way on purpose (SPEC non-goal 6):
your prospects, notes and keys never sit on someone else's server.

## The production server

```bash
npm run build      # once (an update from Settings builds again by itself)
npm start          # http://localhost:3000; `npm start -- -p 3001` for another port
```

It's faster and lighter than `npm run dev`. To have it running whenever you are, make `npm start` (run in this
folder) a login item: a LaunchAgent on macOS, a Task Scheduler task "at log on" on Windows, a systemd user service on
Linux. Webhooks, the public URL and remote agents only reach Inroad while the computer is awake and Inroad is running;
while it's open, connected sequencers, booking tools and CRMs are also polled every few minutes, so nothing is lost
when a webhook can't get through.

## Updating

Settings → General → Updates shows the commits on GitHub that this copy doesn't have yet, and the sidebar says when
there are some. **Update now** does the rest:

1. It backs up the workspace (Settings → Data → Backups lists it as "Before an update").
2. The launcher (`scripts/serve.mjs`) stops the server and shows an "Updating Inroad" page on the same port, which the
   open tab follows step by step.
3. It fast-forwards the branch this copy follows (`git merge --ff-only`), runs `npm ci` when `package-lock.json` or
   `package.json` changed, and `next build` under `npm start`.
4. It starts Inroad again, and the tab reloads into the new version.

If installing or building fails, it puts the commit it was on back (`git reset --hard` to it), installs and builds
that again and starts it, so you're back where you were; Settings and a message say what failed. It only ever moves
forward: it won't update while one of Inroad's own tracked files is changed on this computer, or when this copy has
commits that aren't on GitHub, and says what to do instead (untracked files, like `.data/`, are never touched).
Anything running when you update (research, drafts) stops, so the button asks first. A check is a `git fetch` of
the branch this copy follows, every 6 hours while Inroad runs; turn it off in Settings. Started without the launcher
(a bare `next start`), Inroad can't restart itself, so it shows the commands instead: `git pull`, `npm ci`,
`npm run build`. A new version of the launcher itself takes effect the next time you run `npm start`.

## Only this computer

`npm run dev` and `npm start` go through `scripts/serve.mjs`, which listens on 127.0.0.1 only, so other devices on
your network can't connect at all. It also stamps every request with the address its connection really comes from,
and Inroad decides "this is the founder's computer" from that, never from headers a caller can write. Started any
other way (a bare `next dev` listens on every interface), Inroad refuses every page and says how to start it.
`INROAD_HOST=0.0.0.0` (or `-- -H …`) listens elsewhere, for a VM or a container; other devices then reach only the
endpoints that check a key or secret on every call (MCP, the REST API and hook URLs).

The computer itself is the trust boundary: while Inroad runs, anything on it that can open a connection to
127.0.0.1, including another user account on a shared computer, can use the app as you do (read the workspace,
download a backup). The data files are readable by your user only, but that protects them on disk, not through the
running app. Run Inroad on a computer only you use.

## Where your data lives

Everything is a set of JSON files in one folder: `.data/` inside this repository unless `GTM_DATA_DIR` says
otherwise. Deleting or re-cloning the repository, or `git clean -xfd`, deletes `.data/` with it, so point
`GTM_DATA_DIR` at a folder of its own, ideally one your computer already backs up:

```bash
GTM_DATA_DIR="$HOME/Library/Application Support/Inroad" npm start   # macOS
GTM_DATA_DIR="$HOME/.local/share/inroad" npm start                  # Linux
```

```powershell
$env:GTM_DATA_DIR = "$env:APPDATA\Inroad"; npm start                # Windows PowerShell
```

Settings → Data shows which folder is in use. The files are readable by your user only (0600, folder 0700), and
Inroad's own older files are tightened when it starts (anything else in the folder is left alone). That keeps other accounts from reading them on disk; while Inroad is
running, the app itself answers anyone on this computer (see "Only this computer" above). Your AI provider key is in
the system credential store (or `ai-keys.json`, encrypted), connector keys and the named tunnel's token in
`secrets.json`, agent keys (hashed) in `keys.json`: those belong to this computer and are never in a backup or an
export.

**What leaves your machine:** calls to your AI provider with the context a task needs (none with Ollama); free public
lookups that carry company names and domains (company websites, job boards, news, Hacker News, DNS); place names to
OpenStreetMap (can be turned off) and map tiles from OpenFreeMap; update checks to GitHub (a `git fetch`, or the Mac
app reading the latest release; nothing about your work, and they can be turned off); and what you push to the tools
you connect. Company
icons are first letters unless you turn on fetching each company's icon from its own site (Settings → General); no
favicon service ever sees your list.

## Backups

- **Automatic:** a copy of every workspace file each day you open Inroad and before every reset, sample, restore or update,
  gzipped in `backups/` inside the data folder. Each is kept for 14 days at most (and no more than the last 14 daily
  and 10 others), so someone whose details you delete is gone from them within 14 days.
- **Download:** Settings → Data → **Download backup** gives one JSON file with everything: playbook, companies,
  people, deals, drafts, Ask threads, LinkedIn connections, imports and run history.
- **Restore:** Settings → Data → Backups restores any automatic backup or a downloaded file, here or on another
  computer, after backing up what's there. A workspace JSON exported by an older version restores too. Your
  suppression list survives a restore: anyone who unsubscribed, bounced or asked to be deleted after the backup was
  made stays suppressed, and anyone who asked to have their details deleted is deleted again from what the backup
  brings back. That holds across a reset or the sample too: before either replaces your workspace, its opt-outs are
  added to `opt-outs.json` in the data folder, which nothing replaces and every restore reads.

The automatic backups live in the data folder, so they don't survive deleting it: keep a downloaded backup somewhere
else now and then.

## A public URL that doesn't change

Cloud tools (Calendly, Cal.com, Clay, Zapier, n8n) and remote agents (Meta Muse) need a public https address to
reach Inroad. Integrations → **Enable public URL** starts a Cloudflare tunnel (`cloudflared` must be installed; the
page shows the command). A quick tunnel needs no account but gets a new address every start, so tools stop reaching
Inroad until you paste the new one. **Keep the same address after restarts** sets up a named tunnel on your own domain
(free with a Cloudflare account): one address forever, started again by itself whenever Inroad starts. Only MCP, the
REST API and hook URLs answer through either kind.

No public URL? Instantly, Smartlead, lemlist, HubSpot and Attio are polled for replies and changes while Inroad is
open, and Calendly and Cal.com can be connected with a key so bookings are polled too (Calendly's webhooks need a
paid plan anyway).

## Where your AI key is kept

In your computer's credential store: macOS Keychain, Windows Credential Manager, or the
Secret Service (GNOME Keyring, KWallet) on Linux. Where there's none (a headless server, a container), it's an
AES-256-GCM encrypted file (`ai-keys.json`, with its own random key in `ai-keys.secret`, both readable by your user
only). The current ad hoc signed Mac builds also use that encrypted file: without a consistent Developer ID,
macOS can repeatedly ask for the login password when the Next.js server reads Keychain. Existing Keychain keys
are imported on first use; macOS may ask once per existing key for that transfer. Later launches read the encrypted
copy without opening Keychain. Developer ID builds keep the OS store, and locally migrated keys remain local until
replaced. The encrypted file and its random encryption key are both protected by your account's file permissions,
rather than Keychain's per-application access controls. Either way the API key is never sent to the browser after you save it (you see the provider and the last four
characters), never in a backup or an export, and sent only to the provider you chose. A key saved by an earlier version
of Inroad in `settings.json` is moved into the credential store the first time Inroad reads it.

## What it can't do

Inroad can't be deployed to Vercel, a serverless platform or a shared host, and two people can't share one
workspace. Every page and internal API answers only the computer it runs on; data is files on local disk (read-only
or temporary on serverless); each server process keeps its own copy of each file in memory, so two processes would
overwrite each other; research runs keep working after the request that started them has been answered, which
serverless platforms stop; and the tunnel is a child process. A hosted, multi-user Inroad would need a login and a
real database; that isn't v1.

## Environment variables

| Variable | What it does |
|---|---|
| `GTM_DATA_DIR` | The data folder (default `.data/` in this repository). |
| `ANTHROPIC_API_KEY` | Your Anthropic key, if you'd rather not paste it in the app. A key saved in the app wins. |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY` | Other providers' keys, the same way. `OPENAI_API_KEY` also paints Studio's image layers when no OpenAI key is saved under Settings → General. |
| `INROAD_AI_PROVIDER`, `INROAD_AI_MODEL`, `INROAD_AI_BASE_URL`, `INROAD_AI_KEY` | Pick a provider without the app (servers, scripts): its id (`openai`, `gemini`, `xai`, `groq`, `openrouter`, `mistral`, `deepseek`, `together`, `ollama`, `custom`), the model, and for `custom` the base URL and key. The choice in Settings wins. |
| `OPENAI_BASE_URL` | Send OpenAI calls (chat and Studio images) somewhere else (a gateway); `npm run dev:mock` points it at the mock. |
| `INROAD_KEYCHAIN` | `off` skips the OS store. `prefer-file` imports existing keys once and then uses the encrypted file (the default for ad hoc Mac builds). `on` explicitly selects the OS store for new keys. |
| `INROAD_UPDATE_CHECK` | `off` stops this server from asking GitHub for updates by itself; Settings → Updates → Check now still asks. |
| `FIRECRAWL_API_KEY` | A Firecrawl key for web search off Anthropic, if it is not saved under Web search or connected under Integrations. |
| `INROAD_SEARCH_PROVIDER` | External search provider: `auto` (default), `off`, `firecrawl`, `deepseek`, `tinyfish`, `tavily`, `exa`, `brave`, `custom`, or `connected`. A saved selection wins. DeepSeek requires an explicit choice. |
| `TINYFISH_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_SEARCH_API_KEY` | Search provider keys; DeepSeek search uses `DEEPSEEK_API_KEY` or the saved DeepSeek model key. |
| `INROAD_SEARCH_CONNECTION_ID` | Id of an enabled MCP/OpenAPI connection with a mapped search capability, when using `connected` without saved settings. |
| `INROAD_SEARCH_URL`, `INROAD_SEARCH_KEY` | Full custom search adapter URL and optional bearer key. Receives `{query, limit}` and returns `{results: [{url, title, description}]}`. HTTPS, or HTTP on loopback. |
| `PORT` | The port (default 3000; `-- -p` works too). |
| `INROAD_HOST` | The address to listen on (default 127.0.0.1). |
| `ANTHROPIC_BASE_URL`, `FIRECRAWL_API_URL` | Where those APIs are; `npm run dev:mock` points both at the mock. |
| `MOCK_PORT` | The mock's port (default 4010), for `npm run mock:anthropic` and `npm run dev:mock`. |
