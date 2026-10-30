# GTM execution and measurement

Revenue and Growth include a weekly execution plan beside the numbers already used to run the company. No extra connection or model call is needed.

## Start a priority

Choose **Add initiative**, enter its title and save. The form preselects an available live metric, uses **Me** as owner and sets a review date seven local calendar days ahead. The target is optional. Owner, review date, direction and notes sit under the optional details control. If there is no usable metric, save an unmeasured commitment instead.

Available measurements include connected PostHog, Stripe and Polar metrics; consumer waitlist totals; and business pipeline counts, stated pipeline USD and stage progression rates with enough decided exits. Test metrics carry a test-data label and are never the automatic default. The server reads the selected metric and saves the baseline; clients cannot supply a baseline or result.

Progress is the observed movement from the saved baseline toward the target, capped at 0–100% for display. Decreasing targets are supported. A zero baseline is valid. Reaching a target does not close the priority: **Mark reviewed** explicitly saves the readout, including its source date, cohort size where applicable, source problem and notes. That saved result remains fixed as later metrics change. Reopen to continue work; prior readouts remain in history. Park a priority to remove it from active work.

Changing a target or direction preserves the earlier measurement in history. Choosing a different source or metric starts a new baseline and clears the old target unless a new one is supplied. Source changes never silently transfer a goal to another project or account. Market switching preserves each market's priorities.

**Copy weekly plan** copies active priorities, owners, review dates, observed progress, source times and results reviewed this local week. It does not send a message. In Ask, “my priorities,” “weekly plan” and “overdue initiatives” return local results without a model request. Other Ask questions can use a bounded, read-only `get_gtm_plan` tool.

## Connected metric trends

Successful provider syncs save a first observation and the latest observation each UTC day. Missing days are not interpolated. Charts use actual observation dates and the latest 30 stored points. Comparison uses the last observation at least seven days before the current reading, or the first earlier observation when the history is shorter. The interface always labels the actual comparison date; it does not call a longer or shorter interval a seven-day change. A zero or negative baseline shows an absolute change without an invented growth percentage.

History identity includes the provider connection, environment, project or organization, activity and identity settings, currency, period and counting definition. Ordinary syncs and OAuth refreshes preserve identity. An explicit reconnect conservatively starts a new connection identity, even if it turns out to be the same account. Prior history remains stored, and existing priorities require a deliberate new baseline. Connector credentials are never copied into metric histories or exported plans.

Source failures retain the last successful values and show a problem. Observations more than 24 hours old, impossible source times and readings older than an initiative's baseline cannot establish target attainment. Completed readouts keep the quality state at review time. Provider rolling windows remain provider rolling windows; they do not replace manually logged historical growth weeks or imply calendar-week retention.

## Pipeline creation and progression

The pipeline section uses dated deal stage history, computed locally:

- **New qualified deals** counts the first recorded Qualified entry in the last 30 local calendar dates, including today, compared with the preceding 30 dates. Re-entry never adds another deal. Closed deals still count if first qualified in that window.
- **Their current stated value** sums explicit nonnegative USD deal amounts, falling back to the last stated quote only when the deal amount is absent. Explicit zero remains zero. Unpriced deals are counted and excluded from the dollar total. Values are current stated amounts, not historical valuations or imputed average deal sizes.
- **Qualified deals still open** counts current Qualified, Pilot and Proposal deals. Open qualified deals missing a dated Qualified entry are flagged and excluded from new-pipeline creation.
- Each stage row starts with deals whose first recorded entry into that stage falls within 90 local calendar dates. The first later forward move or loss decides the outcome. A move that skips stages counts as progression out of the entered stage; it does not fabricate entries into skipped stages. A loss remains that cohort's first exit even if the deal is later reopened and won. An earlier backward move does not itself decide the outcome.
- Progression equals forward moves divided by forward moves plus first losses. Waiting deals and outcomes without a dated exit remain visible and excluded from the denominator. Rates appear only after 10 decided exits, a display threshold rather than a statistical-confidence guarantee. Counts and denominators remain visible below that threshold. Median time uses dated forward moves only.

These are descriptive stage-entry cohorts with unresolved outcomes. They are not eventual close probabilities or an experiment proving that an initiative caused a change. Definitions and older unresolved deals are available in the same section, with links to inspect the actual companies.

## Verification scope

Unit tests cover calculation boundaries, source and filter identity, zero baselines, stale or failed data, first exits on reopened deals, skipped stages, idempotent saves, frozen results, market switches, local week boundaries, input validation and the real API's atomic persistence. Browser checks use the real initiative API with synthetic workspace and provider snapshots, including copy, automatic progress, source changes and phone layouts. No private provider account is required by these checks.

A local calculation benchmark with three dated transitions per deal measured a warm-run median of 30.8 ms for 10,000 deals and 77.0 ms for 20,000 deals. This measures the pure pipeline calculation on one development machine, excluding rendering, storage and network. Calculations are memoized in the UI and refresh when workspace data changes or the one-minute clock ticks. There are no new background model calls or provider writes. Business impact still depends on execution and should be measured in actual use.
