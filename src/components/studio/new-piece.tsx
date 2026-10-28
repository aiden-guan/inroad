"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import type {
  StudioFormatId,
  StudioOccasion,
  Workspace,
} from "@/lib/domain/types";
import {
  campaignById,
  recommendedCampaigns,
  type Campaign,
} from "@/lib/studio/campaigns";
import { FORMATS, GROUPS, OCCASIONS, formatsFor } from "@/lib/studio/formats";
import { movesFor } from "@/lib/studio/moves";
import {
  audienceFor,
  competitorsFor,
  formatBlocked,
  receiptsFor,
} from "@/lib/studio/receipts";
import { CampaignDetails } from "./campaign-library";

export interface NewPieceArgs {
  format: StudioFormatId;
  occasion: StudioOccasion;
  brief: string;
  bold: boolean;
  campaignIds?: string[];
  reference?: string;
}

const ALL_OCCASIONS = Object.keys(OCCASIONS) as StudioOccasion[];
const selectClass =
  "h-10 w-full rounded-sm bg-surface px-3 text-[13px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function NewPiece({
  ws,
  onWrite,
  busy,
  format,
  onFormatChange,
  campaignIds,
  onCampaignChange,
  onBrowse,
  onMaterial,
}: {
  ws: Workspace;
  onWrite: (args: NewPieceArgs) => void;
  busy?: boolean;
  format: StudioFormatId;
  onFormatChange: (format: StudioFormatId) => void;
  campaignIds: string[] | undefined;
  onCampaignChange: (ids: string[] | undefined) => void;
  onBrowse: () => void;
  onMaterial: () => void;
}) {
  const audience = audienceFor(ws);
  const ordered = useMemo(() => formatsFor(audience), [audience]);
  const spec = FORMATS[format];
  const occasions = spec.occasions ?? ALL_OCCASIONS;
  const [occasionPick, setOccasion] = useState<StudioOccasion>(
    spec.defaultOccasion,
  );
  const occasion = occasions.includes(occasionPick)
    ? occasionPick
    : spec.defaultOccasion;
  const [brief, setBrief] = useState("");
  const [reference, setReference] = useState("");
  const [bold, setBold] = useState(false);
  const [detail, setDetail] = useState<Campaign | null>(null);
  const blocked = formatBlocked(ws, format);
  const moves = useMemo(
    () =>
      movesFor({
        format,
        audience,
        occasion,
        receipts: receiptsFor(ws),
        competitors: competitorsFor(ws).length,
        bold,
      }),
    [ws, format, audience, occasion, bold],
  );
  const automatic = recommendedCampaigns({ format, audience, occasion, moves });
  const inspiration =
    campaignIds === undefined
      ? automatic
      : campaignIds.flatMap((id) => {
          const campaign = campaignById(id);
          return campaign ? [campaign] : [];
        });
  const missing = moves.filter((move) => move.missing);

  return (
    <section
      aria-labelledby="studio-create-title"
      className="mx-auto max-w-[900px]"
    >
      <header className="mb-6">
        <h2
          id="studio-create-title"
          className="font-serif text-[26px] leading-8 text-fg"
        >
          What are you making?
        </h2>
        <p className="mt-2 text-[14px] leading-6 text-fg-2">
          Your material and relevant campaigns. Distinct options, checked before
          you review.
        </p>
      </header>

      <div className="rounded-lg bg-surface p-5 ring-1 ring-border sm:p-6">
        <div className="grid gap-4 min-[380px]:grid-cols-2">
          <div>
            <Label htmlFor="studio-format">Format</Label>
            <select
              id="studio-format"
              value={format}
              onChange={(event) =>
                onFormatChange(event.target.value as StudioFormatId)
              }
              className={selectClass}
            >
              {GROUPS.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {ordered
                    .filter((item) => item.group === group.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="studio-occasion">Occasion</Label>
            <select
              id="studio-occasion"
              value={occasion}
              onChange={(event) =>
                setOccasion(event.target.value as StudioOccasion)
              }
              className={selectClass}
            >
              {occasions.map((id) => (
                <option key={id} value={id}>
                  {OCCASIONS[id].label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] leading-5 text-fg-3">{spec.blurb}</p>

        <div className="mt-5">
          <Label htmlFor="studio-brief" hint="Optional">
            What should this say?
          </Label>
          <Textarea
            id="studio-brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder={
              occasion === "launch"
                ? "What’s launching, who it’s for, and what makes it worth trying…"
                : "The idea, audience or real moment you want to lead with. Leave blank to start from your playbook."
            }
            className="min-h-24 text-[14px] leading-6"
          />
        </div>

        <div className="mt-6 border-t border-border pt-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-fg">
                Campaign inspiration
              </h3>
              <p className="mt-1 text-[12px] leading-[18px] text-fg-3">
                {campaignIds === undefined
                  ? "Matched to your format, audience and available material."
                  : "Your chosen approach. Your facts and voice still lead."}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onBrowse}>
              Browse campaign library{" "}
              <ArrowRight aria-hidden className="size-3.5" />
            </Button>
          </div>
          {inspiration.length ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {inspiration.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  onClick={() => setDetail(campaign)}
                  aria-label={`Read ${campaign.brand} inspiration`}
                  className="rounded-md bg-bg-subtle p-3 text-left ring-1 ring-border transition-colors hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <span className="block text-[12px] font-semibold text-fg">
                    {campaign.brand}
                  </span>
                  <span className="mt-1 block text-[12px] leading-[18px] text-fg-2">
                    {campaign.title}
                  </span>
                  <span className="mt-2 block text-[11px] text-fg-3">
                    View approach & source →
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-bg-subtle p-3 text-[13px] leading-5 text-fg-2">
              {campaignIds === undefined
                ? "Your material leads this format. Browse the library to choose an approach."
                : "Writing from your own material, without a campaign reference."}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            {campaignIds !== undefined && (
              <button
                type="button"
                onClick={() => onCampaignChange(undefined)}
                className="min-h-8 text-[12px] text-accent-text hover:underline"
              >
                Choose automatically
              </button>
            )}
            {inspiration.length > 0 && (
              <button
                type="button"
                onClick={() => onCampaignChange([])}
                className="min-h-8 text-[12px] text-fg-3 hover:text-fg"
              >
                Skip campaign inspiration
              </button>
            )}
          </div>
        </div>

        <details className="mt-3 border-t border-border pt-4">
          <summary className="cursor-pointer rounded-sm py-1 text-[13px] font-medium text-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
            Add your own example or adjust creative direction
          </summary>
          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="studio-reference" hint="Optional">
                Your own inspiration
              </Label>
              <Textarea
                id="studio-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                maxLength={2000}
                placeholder="Paste example copy or a link, and describe the approach you’d like to learn from."
                className="min-h-24 text-[13px]"
              />
              <p className="mt-1.5 text-[12px] leading-[18px] text-fg-3">
                Examples guide the approach. Claims about your product still
                need your own source.
              </p>
            </div>
            <label className="flex items-start gap-2 text-[12px] leading-[18px] text-fg-2">
              <input
                type="checkbox"
                checked={bold}
                onChange={(event) => setBold(event.target.checked)}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                Allow provocative concepts.
                <span className="block text-fg-3">
                  These trade trust for attention. You review every option
                  before publishing.
                </span>
              </span>
            </label>
            {missing.length > 0 && (
              <p className="text-[12px] leading-5 text-fg-3">
                More material can unlock:{" "}
                {missing
                  .slice(0, 3)
                  .map(
                    (choice) => `${choice.move.name} (needs ${choice.missing})`,
                  )
                  .join("; ")}
                .
              </p>
            )}
          </div>
        </details>

        <div className="sticky bottom-0 z-20 mt-5 flex flex-col gap-3 border-t border-border bg-surface py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-[12px] leading-[18px]">
            {blocked ? (
              <>
                <p className="text-warning">{blocked}</p>
                <button
                  type="button"
                  onClick={onMaterial}
                  className="mt-1 min-h-8 text-accent-text hover:underline"
                >
                  Add supporting material
                </button>
              </>
            ) : (
              <p className="text-fg-3">
                {spec.options} distinct options, checked for unsupported claims
                and format limits.
              </p>
            )}
          </div>
          <Button
            variant="agent"
            size="lg"
            icon={<Sparkles aria-hidden className="size-4" />}
            disabled={!!blocked}
            loading={busy}
            onClick={() =>
              onWrite({
                format,
                occasion,
                brief: brief.trim(),
                bold,
                campaignIds: inspiration.map((campaign) => campaign.id),
                reference: reference.trim() || undefined,
              })
            }
          >
            Write {spec.options} options
          </Button>
        </div>
      </div>
      <p className="mt-4 text-center text-[12px] leading-5 text-fg-3">
        Your existing playbook and material are ready to use.{" "}
        <button
          type="button"
          onClick={onMaterial}
          className="text-fg-2 underline underline-offset-4 hover:text-fg"
        >
          Edit brand & material
        </button>
      </p>
      <CampaignDetails
        campaign={detail}
        onClose={() => setDetail(null)}
        onUse={(campaign) => {
          onCampaignChange([campaign.id]);
          setDetail(null);
        }}
      />
    </section>
  );
}
