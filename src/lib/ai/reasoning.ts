/** Reasoning levels offered by the model picker. Unset means use each task's preset. */
export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: "None", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum",
};

/** Conservative choices for known OpenAI families; unknown models keep their task defaults. */
export function reasoningEfforts(model: string): readonly ReasoningEffort[] {
  if (/^gpt-6(?:\.\d+)?-(?:astra|sol|terra|luna)(?:-|$)/.test(model)) {
    const requiresReasoning = /^gpt-6(?:\.\d+)?-astra(?:-|$)|^gpt-6\.1-sol(?:-|$)/.test(model);
    return requiresReasoning ? REASONING_EFFORTS.filter((e) => e !== "none") : REASONING_EFFORTS;
  }
  if (/^gpt-5(?:[.-]|$)|^o[134](?:-|$)/.test(model)) return ["low", "medium", "high"];
  return [];
}

/** A connection-wide choice must work with every configured task model. */
export function sharedReasoningEfforts(models: string[]): readonly ReasoningEffort[] {
  return models.length ? reasoningEfforts(models[0]).filter((effort) => models.every((m) => reasoningEfforts(m).includes(effort))) : [];
}

/** GPT-6 tool calling with reasoning uses the Responses API. Other providers retain their own protocol. */
export function usesResponses(provider: string, model: string): boolean {
  return provider === "openai" && /^gpt-6(?:[.-]|$)/.test(model);
}
