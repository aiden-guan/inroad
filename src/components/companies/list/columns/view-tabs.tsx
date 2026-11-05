"use client";

import { motion, useReducedMotion } from "motion/react";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuItem, MenuSeparator, Popover } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import { LIMITS, type SavedView } from "@/lib/columns/types";
import { spring } from "@/lib/motion";

/**
 * Saved views as tabs above the table: filters, sort and visible columns under a name, one click away and
 * addressable as ?viewId=. When the filters drift from the view, a pill offers to save (⌘S).
 */
export function ViewTabs({
  views,
  activeId,
  dirty,
  suggest,
  saveOpen,
  onSaveOpenChange,
  onSelect,
  onSave,
  onSaveAs,
  onDiscard,
  onRename,
  onDelete,
}: {
  views: SavedView[];
  activeId: string | null;
  dirty: boolean;
  /** A starting name for a new view. */
  suggest: string;
  /** The "name this view" popover; ⌘S opens it too. */
  saveOpen: boolean;
  onSaveOpenChange: (open: boolean) => void;
  onSelect: (id: string | null) => void;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onDiscard: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const [renaming, setRenaming] = useState<string | null>(null);
  const setSaveOpen = onSaveOpenChange;
  if (!views.length && !dirty) return null;

  const tab = (id: string | null, label: string, view?: SavedView) => {
    const active = id === activeId;
    if (view && renaming === view.id) {
      return (
        <RenameField
          key={view.id}
          initial={view.name}
          onDone={(name) => {
            setRenaming(null);
            if (name && name !== view.name) onRename(view.id, name);
          }}
        />
      );
    }
    return (
      <span key={id ?? "all"} className="relative flex shrink-0 items-center">
        <button
          role="tab"
          aria-selected={active}
          onClick={() => onSelect(id)}
          onDoubleClick={() => view && setRenaming(view.id)}
          title={view ? "Double-click to rename" : undefined}
          className={cn(
            "relative flex h-9 max-w-56 items-center gap-1.5 px-2.5 text-[13px] font-medium transition-colors duration-150",
            active ? "text-fg" : "text-fg-3 hover:text-fg-2",
          )}
        >
          <span className="truncate">{label}</span>
          {active && dirty && <span aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-accent" />}
          {active && <motion.span layoutId="prospect-view-tab" transition={reduce ? { duration: 0 } : spring.snappy} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-fg" />}
        </button>
        {active && view && (
          <Menu
            align="start"
            trigger={
              <IconButton label={`${view.name}: more`} className="-ml-1.5 size-6">
                <Ellipsis className="size-3.5" />
              </IconButton>
            }
          >
            <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setRenaming(view.id)}>
              Rename
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => onDelete(view.id)}>
              Delete view
            </MenuItem>
          </Menu>
        )}
      </span>
    );
  };

  return (
    <div className="mb-3 flex items-end gap-2 border-b border-border">
      <div role="tablist" aria-label="Saved views" className="-mb-px flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-none">
        {tab(null, "All prospects")}
        {views.map((v) => tab(v.id, v.name, v))}
      </div>
      {dirty && (
        <div className="flex shrink-0 items-center gap-1 pb-1.5">
          {activeId ? (
            <>
              <Button size="xs" variant="ghost" onClick={onDiscard}>
                Discard
              </Button>
              <Popover
                open={saveOpen}
                onOpenChange={setSaveOpen}
                align="end"
                className="w-[min(300px,calc(100vw-32px))] p-3"
                trigger={
                  <Button size="xs" variant="ghost">
                    Save as new
                  </Button>
                }
              >
                <SaveForm
                  initial={suggest}
                  onSave={(name) => {
                    setSaveOpen(false);
                    onSaveAs(name);
                  }}
                />
              </Popover>
              <Button size="xs" variant="primary" onClick={onSave} kbd="⌘S">
                Save view
              </Button>
            </>
          ) : (
            <Popover
              open={saveOpen}
              onOpenChange={setSaveOpen}
              align="end"
              className="w-[min(300px,calc(100vw-32px))] p-3"
              trigger={
                <Button size="xs" variant="secondary" kbd="⌘S">
                  Save view
                </Button>
              }
            >
              <SaveForm
                initial={suggest}
                onSave={(name) => {
                  setSaveOpen(false);
                  onSaveAs(name);
                }}
              />
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}

/** Lets the shortcut open the same form the pill does. */
export function SaveForm({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n) onSave(n.slice(0, LIMITS.viewName));
  };
  return (
    <form onSubmit={submit}>
      <Label htmlFor="view-name">Name this view</Label>
      <Input id="view-name" autoFocus value={name} maxLength={LIMITS.viewName} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
      <p className="mt-1.5 text-[11.5px] leading-[16px] text-fg-3">Saves these filters, the sort and which columns show.</p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="mr-auto hidden items-center gap-1 text-[11.5px] text-fg-3 md:pointer-fine:flex">
          <Kbd>↵</Kbd> save
        </span>
        <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>
          Save view
        </Button>
      </div>
    </form>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(initial);
  // Enter, Esc and blur can all end it; only the first one counts.
  const ended = useRef(false);
  const finish = (value: string | null) => {
    if (ended.current) return;
    ended.current = true;
    onDone(value);
  };
  return (
    <form
      className="flex h-9 shrink-0 items-center px-1"
      onSubmit={(e) => {
        e.preventDefault();
        finish(name.trim() || null);
      }}
    >
      <Input
        autoFocus
        value={name}
        maxLength={LIMITS.viewName}
        aria-label="View name"
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => finish(name.trim() || null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
          }
        }}
        className="h-7 w-44 text-[13px]"
      />
    </form>
  );
}
