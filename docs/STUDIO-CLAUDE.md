# Claude-plan creation in Studio

Studio's **Create with** choice applies to copy, graphic composition, prompt writing, render review and repair. Choose **Claude plan** and **Connect Claude** to use the official local Claude runtime's subscription sign-in. The choice persists on this computer. Other Inroad workflows keep their configured AI provider.

Claude creates graphics in code: it returns SVG around approved words, Inroad checks and renders the SVG locally, and Claude reviews the PNG before any repair pass. The resulting PNG and SVG are saved in Studio and available to download. This includes vector illustrations and other code-rendered visuals; a separate image-painting model is optional.

1. Install Claude Desktop with Claude Code, or a current Claude Code CLI.
2. Open Studio, select **Create with → Claude plan**, and select **Connect Claude**.
3. An existing local Claude subscription sign-in is reused after verifying it with `claude auth status`. Otherwise, finish Claude's official browser sign-in.
4. Write copy in Create, or choose a saved message in Graphics, select **Draw in code**, add direction and select **Design 2 graphics**. Claude can draw illustrations, shapes and typography directly in SVG without an uploaded or painted picture layer.
5. For a painted picture layer, select **AI image → ChatGPT plan** and connect ChatGPT separately. Claude can compose and review the graphic around that image using its own plan. **Generate image in ChatGPT** remains a direct, independent PNG action.

Claude-plan jobs use the plan's allowance and any extra usage enabled in Claude. They do not reserve or charge Inroad's API dollar budget. The CLI's estimated API-equivalent price is not recorded as a subscription charge. Limits and access depend on the Claude account; Inroad does not claim unlimited or free generation. A limit or authentication error stops the job without API-key fallback. Selecting **OpenAI API** for a painted layer explicitly uses that route's key, budget and billing.

## Authentication and execution

- Uses the official CLI's documented Agent SDK/headless streaming protocol, not a token-sharing proxy or a custom OAuth client. Claude owns authentication, token storage and refresh. Inroad never reads browser cookies or copies credentials.
- Stores only shared/private permission in `<data>/claude-plan-connection.json`. New sign-ins use a private `CLAUDE_CONFIG_DIR` at `<data>/claude-plan-auth`, outside workspace exports and backups. Neither auth directory nor permission file is part of a workspace backup.
- Disconnect cancels active requests and revokes Inroad's permission. A shared Claude sign-in remains available to other apps; an Inroad-private sign-in is logged out.
- Local, same-origin connection routes inherit the server's proxy protections. External agent endpoints do not expose sign-in operations.
- Discovers the Claude Desktop runtime or the `claude` executable on PATH. An absolute `INROAD_CLAUDE_PATH` can select a local executable. Older runtimes missing required safe-mode/structured-output flags must be updated.
- Uses safe mode, no project/user customizations or hooks, no built-in tools, no MCP servers, no session persistence, a temporary working directory, bounded output, a four-minute request timeout and two concurrent requests at most. Inherited API keys, Anthropic endpoint overrides and alternate provider switches are removed. Both connection and inference reject API-key accounts.
- Sends the task's existing JSON schema and validates the result again with Zod. Review PNGs travel as direct image blocks; the model has no filesystem access. Strategist/operator/fast tasks use the runtime's Opus/Sonnet/Haiku aliases.

Official references: [Claude plan and Agent SDK](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [CLI reference](https://code.claude.com/docs/en/cli-reference), [headless execution](https://code.claude.com/docs/en/headless), [structured output](https://code.claude.com/docs/en/agent-sdk/structured-outputs).

## Verification

Unit fixtures cover explicit permission, shared-session disconnect, key removal, direct multimodal input, schema validation, quota rejection, cancellation and API-budget isolation. Browser coverage checks creator choice, connection, copy/design arguments, mobile layout, persistence and disconnect behavior.

Opt-in `INROAD_CLAUDE_LIVE_TEST=1` tests run the real SVG design/render/vision-review and copy pipelines with an authenticated Claude Max plan in an isolated sample workspace. The graphics test produced a 1200×630 PNG and SVG; the sanitizer removed an unsupported SVG reference and the visual review retained suggested creative improvements. Those warnings remain visible rather than being presented as a quality guarantee. A fresh account's browser sign-in and quota exhaustion use fixtures; plan availability can vary.
