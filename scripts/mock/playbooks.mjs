/**
 * Per-tool playbooks: how a real model would work through each workflow's tools, turn by turn, with
 * input built from what the request actually contains. A playbook may also choose the turn's web
 * search (query and results) and its thinking lines. Tools without a playbook get the schema-driven
 * fallback in plan.mjs.
 *
 *   { match(ctx) → boolean, act(ctx) → { blocks }, search?(ctx), wantsSearch?(ctx), thinking?(ctx) }
 */

export const PLAYBOOKS = [];
