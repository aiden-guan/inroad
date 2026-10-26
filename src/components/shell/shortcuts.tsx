"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

const GROUPS: { title: string; rows: [keys: string[], what: string][] }[] = [
  {
    title: "Everywhere",
    rows: [
      [["⌘", "K"], "Ask, or jump to a company, page or action"],
      [["?"], "These shortcuts"],
      [["G", "T"], "Today"],
      [["G", "R"], "Creators and communities"],
      [["G", "C"], "Companies"],
      [["G", "N"], "Intros"],
      [["G", "E"], "Events"],
      [["G", "P"], "Playbook"],
      [["G", "I"], "Integrations"],
      [["G", "S"], "Settings"],
    ],
  },
  {
    title: "Today",
    rows: [
      [["J"], "Next move"],
      [["K"], "Previous move"],
      [["Enter"], "Open it"],
      [["A"], "Done"],
      [["X"], "Skip"],
      [["S"], "Tomorrow"],
      [["Esc"], "Close"],
    ],
  },
  {
    title: "A draft",
    rows: [
      [["A"], "Mark as sent"],
      [["E"], "Edit the text"],
      [["]"], "A different angle"],
      [["["], "Back to the previous one"],
    ],
  },
  {
    title: "Events",
    rows: [[["N"], "Plan an event"]],
  },
];

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** "?" anywhere (outside a text field) shows every keyboard shortcut, grouped by where it works. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("inroad:shortcuts", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("inroad:shortcuts", onOpen);
    };
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" className="max-w-[640px]">
      <div className="grid gap-x-8 gap-y-5 px-5 pb-5 pt-3 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-[11.5px] font-medium text-fg-3">{g.title}</h3>
            <dl className="space-y-1">
              {g.rows.map(([keys, what]) => (
                <div key={what} className="flex items-center justify-between gap-3 text-[13px]">
                  <dt className="text-fg-2">{what}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {keys.map((k, i) => (
                      <span key={k} className="flex items-center gap-1">
                        {i > 0 && keys[0] === "G" && <span className="text-[11px] text-fg-4">then</span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
