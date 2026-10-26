"use client";

import { CONNECTORS, type BookingId } from "@/lib/connectors/catalog";
import type { IntegrationState } from "@/lib/domain/types";
import { ConnectedFooter, KeyConnect } from "./key-connect";
import { Disclosure } from "./parts";

/**
 * The polling way in for a booking tool: a key, so new, moved and canceled bookings are read every few
 * minutes while Inroad is open. For Calendly on Free (no webhooks) and for anyone without a public URL.
 */
export function BookingKey({
  id,
  state,
  replacing,
  onReplace,
  onDone,
}: {
  id: BookingId;
  state: IntegrationState | undefined;
  replacing: boolean;
  onReplace: () => void;
  onDone: () => void;
}) {
  const meta = CONNECTORS[id];
  if (state?.enabled && !replacing) {
    return (
      <div>
        <p className="text-[13px] leading-[19px] text-fg-2">
          Connected with a key: I check {meta.name} for new, moved and canceled bookings every 5 minutes while Inroad is open, whenever its webhooks can&apos;t reach this
          computer. Nothing is written to {meta.name}.
        </p>
        <ConnectedFooter id={id} state={state} onReplace={onReplace} />
      </div>
    );
  }
  const form = <KeyConnect id={id} onConnected={onDone} onCancel={replacing ? onDone : undefined} />;
  return replacing ? form : <Disclosure title="Or connect with a key, no webhook needed">{form}</Disclosure>;
}
