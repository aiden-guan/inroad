import "server-only";
import { request } from "./http";
import { fail, ok, type Connector, type ConnectorFactory } from "./types";

/**
 * Slack incoming webhook. The URL is the secret (Slack revokes leaked ones), so it never leaves
 * secrets.json and is redacted from every message. There is no "who am I" for a webhook URL, so
 * validation posts one short, clearly labelled test message; the founder asked for it by connecting.
 */

const TOOL = "Slack";
export const SLACK_URL = /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/;

/** Slack's plain-text error bodies → what to do. */
const ERRORS: Record<string, string> = {
  invalid_payload: "Slack couldn't read the message.",
  no_text: "Slack needs text in every message.",
  channel_not_found: "That channel no longer exists. Create a new webhook for another channel.",
  action_prohibited: "A Slack admin has blocked this webhook.",
  posting_to_general_channel_denied: "Only admins can post to #general. Pick another channel.",
  no_service: "This webhook was removed in Slack. Create a new one and paste it here.",
  no_active_hooks: "This webhook was turned off in Slack. Create a new one and paste it here.",
  channel_is_archived: "That channel is archived. Create a webhook for an active channel.",
};

export const slack: ConnectorFactory = (url) => {
  const connector: Connector = {
    id: "slack",
    name: TOOL,

    async validate() {
      if (!SLACK_URL.test(url.trim())) return fail("validation", "That isn't a Slack incoming webhook URL. It starts with https://hooks.slack.com/services/.");
      const sent = await connector.notify!.post({
        text: "Inroad is connected. Your daily brief and interested-reply alerts will post here.",
      });
      return sent.ok ? ok({ accountLabel: "Incoming webhook" }) : sent;
    },

    notify: {
      async post(message) {
        const r = await request<string>({ tool: TOOL, method: "POST", url: url.trim(), body: message, secrets: [url], retries: 1 });
        if (r.ok) return ok(undefined);
        const code = r.error.message.match(/(invalid_payload|no_text|channel_not_found|action_prohibited|posting_to_general_channel_denied|no_service|no_active_hooks|channel_is_archived)/)?.[1];
        if (code) return fail(code === "no_service" || code === "no_active_hooks" || code === "channel_is_archived" ? "auth" : "validation", ERRORS[code], r.error.status);
        return r;
      },
    },
  };
  return connector;
};
