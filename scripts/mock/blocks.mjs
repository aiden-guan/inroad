/** Small builders shared by the planner and the playbooks. */

let counter = 0;
export const mockId = (p) => `${p}_mock${(++counter).toString(36)}`;

export const text = (t) => ({ type: "text", text: t });
export const call = (name, input) => ({ type: "tool_use", id: mockId("toolu"), name, input });

/** The latest call of a tool in the conversation, with the result the app sent back. */
export function lastCall(ctx, name) {
  return [...ctx.calls].reverse().find((c) => c.name === name);
}

export const submitted = (ctx, name) => ctx.calls.some((c) => c.name === name && c.result !== null && !c.isError);
