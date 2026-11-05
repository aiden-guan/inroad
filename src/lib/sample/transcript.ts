import { makeClock, type Clock } from "./clock";

/**
 * "Try with a sample transcript": Priya's 17-minute discovery call with Tidewell, the messaging-API company
 * on her calendar that isn't in the pipeline yet, as Zoom's cloud recording saves it (a WebVTT file named
 * GMT<date>-<time>_Recording.transcript.vtt). Timestamps follow the words at a natural pace. Fictional.
 */

/** The most recent weekday before today, at 15:00: when the Tidewell discovery call happened (it's on the sample calendar). */
export function tidewellCallAt(c: Clock): string {
  for (let n = 1; n <= 4; n++) {
    const day = new Date(`${c.d(-n)}T12:00:00`).getDay();
    if (day !== 0 && day !== 6) return c.at(-n, "15:00");
  }
  return c.at(-1, "15:00");
}

const PRIYA = "Priya Raman";
const MAREN = "Maren Holt";
const ARJUN = "Arjun Patel";

const SCRIPT: [string, string][] = [
  [PRIYA, "Hi Maren, thanks for making the time. Can you hear me okay?"],
  [MAREN, "Loud and clear. Arjun's joining too, he's just finishing another call."],
  [PRIYA, "Perfect. So I have us down for thirty minutes. I'd like to hear how month-end works for you today, especially the usage side, then tell you briefly what we do, and at the end we can decide together if a next step makes sense. If it's not a fit, I'd rather we say so today. Does that work?"],
  [MAREN, "That works. Honestly, that's refreshing."],
  [PRIYA, "Before we start, how did you hear about us? I want to make sure I thank the right person."],
  [MAREN, "Your post about late events and invoice runs got forwarded around our finance channel. Arjun sent it to me with three exclamation points, which is a lot for Arjun."],
  [PRIYA, "I'll take that. To start, can you walk me through how revenue gets closed each month at Tidewell?"],
  [MAREN, "Sure. So we sell a messaging API. Customers pay per message sent and per active phone number, and about eighteen months ago we moved almost everyone onto usage-based pricing. Finance is five people. I'm the controller, and Arjun runs revenue accounting."],
  [PRIYA, "And where does the usage come from?"],
  [MAREN, "Metering lands in Snowflake. Invoices come out of Stripe Billing. In between there's a spreadsheet that Arjun lovingly calls the monster."],
  [ARJUN, "Sorry, I'm here. Hi Priya. Yes, the monster. It's about forty tabs."],
  [PRIYA, "Hi Arjun. Before we get into the monster, how big is this? Roughly how many customers and how much usage are we talking about?"],
  [ARJUN, "About eleven hundred paying customers. Last month was a little over four hundred million messages across three products, and the big accounts each have their own rate card."],
  [MAREN, "And about sixty percent of revenue comes from the top forty. Those are the ones that matter for January."],
  [PRIYA, "Got it. Tell me about the monster. What happens in it each month?"],
  [ARJUN, "We export usage from Snowflake, we export invoice lines from Stripe, and we match them on customer and product. Then we chase everything that doesn't tie. The usage tie-out alone takes about six days every close."],
  [PRIYA, "Six days. What makes it take that long?"],
  [ARJUN, "Late events, mostly. Carrier delivery receipts can come in up to seventy-two hours after the message, so usage keeps changing after Stripe has already invoiced. Then there are credits and re-rated messages. Every month something new breaks the matching."],
  [PRIYA, "Walk me through the last close. What did the six days actually look like?"],
  [ARJUN, "Day one and two are exports and fixing the joins. Day three is the rate cards, because the big customers all have exceptions. Days four to six are chasing the lines that still don't match, and that's mostly me messaging the data team to ask if an event is real."],
  [PRIYA, "And when you ask the data team, how long does an answer take?"],
  [ARJUN, "A day if I'm lucky. They have their own roadmap, so we're always the interruption."],
  [PRIYA, "When it doesn't tie in the end, what happens?"],
  [MAREN, "Last quarter we found a sixty-two thousand dollar gap between metered usage and what we invoiced. We tracked most of it down, but we wrote off eighteen thousand dollars because we couldn't prove the usage to the customer."],
  [PRIYA, "That's real money. How did that land internally?"],
  [MAREN, "Not well. Noah, our CFO, asked me to make sure it doesn't happen again before we change pricing in January."],
  [PRIYA, "Has anything like that come back from customers? Disputes, credits?"],
  [MAREN, "Two of our largest customers disputed invoices in September. One of them asked us to show message-level usage for the whole month. It took Arjun a week to pull it together, and we still gave them a credit to end the conversation."],
  [ARJUN, "That was the worst week of my quarter."],
  [PRIYA, "What's changing in January?"],
  [MAREN, "We're moving our top forty customers onto committed-use contracts on January first. So instead of pure pay as you go, they commit to a monthly minimum and pay overage above it. And our auditors flagged usage revenue as a key audit matter for the year-end audit."],
  [PRIYA, "So what happens if the January close goes like last quarter?"],
  [MAREN, "If we can't tie committed usage to invoices by the January close, the audit drags on, the audit fee goes up, and the board hears about a control weakness. I don't want to be the controller explaining that."],
  [PRIYA, "Understood. What are you spending on this today, in people or tools?"],
  [ARJUN, "My first week of every month, basically. And we pay a contractor about nine thousand dollars a quarter to keep the workbook from falling apart."],
  [MAREN, "We also have a revenue systems analyst role open. If I'm honest, half of that job description is running the monster."],
  [PRIYA, "Have you looked at fixing it another way? Building something, or changing billing systems?"],
  [MAREN, "Our data team offered to build dbt models for it, but they're booked through the first quarter. And a billing migration is a year-long project we can't take on before January."],
  [ARJUN, "We also tried a reconciliation feature in our billing tool, but it only looks at invoices. It never sees the raw usage, so it can't explain anything."],
  [PRIYA, "And if you did nothing, and went into January with the workbook as it is?"],
  [MAREN, "Then I'd hire the analyst, we'd throw people at the close, and we'd hope the committed-use true-ups don't add another ten tabs. I don't love that plan, but it's the default."],
  [PRIYA, "That's helpful. Can I take a minute to tell you what we do, and you tell me where it doesn't fit?"],
  [MAREN, "Please."],
  [PRIYA, "Ledgerline reads usage straight from your warehouse, read-only, and matches every metered event to the invoice line it landed on. When something doesn't tie, it tells you why: a late event, a credit, a re-rate, or usage that was never billed. Our first design partner went from a four-day tie-out to under a day on their first close. I spent five years building the metering-to-invoice pipeline at Tollgate, so this is the problem I know best."],
  [ARJUN, "Does it handle late events that arrive after the invoice? That's the part that kills us."],
  [PRIYA, "Yes. Late events are matched to the period they belong to, and you see which ones arrived after the invoice ran, so you can decide whether to bill them next cycle or credit them."],
  [ARJUN, "Okay. That would have saved us most of last quarter."],
  [MAREN, "What does it need from our side? Our data engineer will ask."],
  [PRIYA, "A read-only role in Snowflake and a restricted Stripe key. Nothing writes back to your systems."],
  [MAREN, "Kenji will want a security review. That's usually about two weeks with us, and he'll ask for a questionnaire up front."],
  [PRIYA, "I'll send our security questionnaire answers and a data-flow diagram tomorrow, so he has them before anything else. Who else would be involved in a decision like this?"],
  [MAREN, "Noah signs anything over twenty-five thousand dollars. Legal reviews the contract, but we don't have a procurement team. Budget would come out of the finance tools budget for next year, which we set in December."],
  [PRIYA, "When do you need to have this decided, to be ready for January?"],
  [MAREN, "Realistically before the December budget meeting, which is the twelfth. If it isn't in the budget by then, it waits until spring."],
  [PRIYA, "So working back from the twelfth, we'd want the pilot results in front of Noah the first week of December."],
  [MAREN, "That's right. That's tight, but it's doable."],
  [PRIYA, "And how would Noah decide?"],
  [MAREN, "He'll want to see it work on our own data first. If I can show him last month's close matched end to end, I can bring him in for a short call."],
  [PRIYA, "That's fair. Is there anything that would stop this before Noah even sees it?"],
  [MAREN, "Timing. December is year-end for us, and my team is small. If a pilot means my people do a lot of setup work in December, it won't happen."],
  [PRIYA, "That's a reasonable worry. The setup is a read-only connection and one working session. We do the matching rules ourselves, and Arjun reviews the output. If it starts taking his time instead of saving it, we stop."],
  [ARJUN, "If it's one session, I can do that. What I can't do is another spreadsheet."],
  [PRIYA, "No spreadsheets, I promise. What would make this a clear success for you?"],
  [ARJUN, "Getting the usage tie-out from six days to one, and every unexplained line under half a percent of billed revenue."],
  [MAREN, "And being able to hand the auditors a trail for every usage invoice."],
  [MAREN, "What does it cost, roughly? So I know which conversation I'm having with Noah."],
  [PRIYA, "Design partners pay two thousand five hundred dollars a month during the pilot, and that's credited to the annual plan if you continue."],
  [MAREN, "That's within what I can bring to Noah."],
  [PRIYA, "To be clear, the pilot is paid, so we both take it seriously. If it doesn't hit the numbers Arjun just gave, you don't continue."],
  [MAREN, "Understood. Noah will like that it's tied to numbers."],
  [PRIYA, "Here's what I'd suggest as a next step. A working session with Arjun and Kenji where we connect read-only to Snowflake and run last month's close through Ledgerline. Would next Thursday at two work?"],
  [ARJUN, "Thursday at two works for me."],
  [MAREN, "Thursday at two works. I'll send the invite to Kenji and loop in Noah afterwards if the numbers hold up."],
  [PRIYA, "Great. Let me play back what I heard, and tell me what I got wrong. The usage tie-out takes about six days, late carrier receipts break the matching, last quarter you wrote off eighteen thousand dollars, and January's committed-use contracts plus the audit make it urgent. Success is a one-day tie-out with unexplained lines under half a percent, and Noah decides after he sees it work on your data."],
  [MAREN, "That's exactly it. I'd add the disputes. If we can answer a customer's usage question in an hour instead of a week, that alone is worth it."],
  [PRIYA, "Noted, I'll put that in the success criteria too. Before we go, is there anyone else you know who's fighting the same problem? I'd love to compare notes with them."],
  [MAREN, "You should talk to Lucia Ortega at Brightline. She had the same mess when they moved to usage pricing."],
  [PRIYA, "Thank you, I'll mention you sent me. I'll send a recap today with what I heard and the security documents tomorrow."],
  [MAREN, "Sounds good. Thanks, Priya."],
  [ARJUN, "Thanks, talk Thursday."],
];

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
function stamp(seconds: number): string {
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(seconds / 3600)}:${pad((seconds % 3600) / 60)}:${pad(seconds % 60)}.${pad(ms, 3)}`;
}

/** Zoom writes one cue per sentence or two; a turn longer than that is split at sentence ends. */
function cues(text: string): string[] {
  const sentences = text.match(/[^.?!]+[.?!]+/g)?.map((s) => s.trim()) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    const last = out.length - 1;
    if (last >= 0 && out[last].split(" ").length + s.split(" ").length <= 22) out[last] = `${out[last]} ${s}`;
    else out.push(s);
  }
  return out;
}

export interface SampleTranscript {
  fileName: string;
  text: string;
}

export function sampleTranscript(now = new Date()): SampleTranscript {
  const c = makeClock(now);
  const startedAt = new Date(c.plus(tidewellCallAt(c), 1));
  const lines = ["WEBVTT", ""];
  let t = 3.2;
  let n = 1;
  for (const [speaker, text] of SCRIPT) {
    for (const cue of cues(text)) {
      const seconds = Math.max(1.6, cue.split(" ").length / 2.15);
      lines.push(String(n++), `${stamp(t)} --> ${stamp(t + seconds)}`, `${speaker}: ${cue}`, "");
      t += seconds + 0.5;
    }
    t += 1.4;
  }
  const iso = startedAt.toISOString();
  const fileName = `GMT${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}_Recording.transcript.vtt`;
  return { fileName, text: lines.join("\n") };
}
