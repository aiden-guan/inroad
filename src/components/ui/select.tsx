"use client";

import * as RP from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import {
  Fragment,
  forwardRef,
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/client/cn";
import { fieldClass } from "./field";
import { nextEnabled, typeahead } from "./listbox";

/**
 * A drop-in for `<select value onChange>`. It is still a real <select>: its value, its label, forms, `onChange`
 * with `e.target.value`, browser tests (`selectOption`, `toHaveValue`), screen readers' own select handling, and
 * the phone's own picker on touch. With a mouse or the keyboard it opens the app's list instead of the browser's:
 * the menus' surface, the chosen option checked, ↑ ↓ Home End PageUp PageDown and typing to move, Enter or Space
 * to pick, Esc or Tab to close without picking. Options come from the <option> and <optgroup> children.
 */

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Keep the browser's own list (a select the user should see as the operating system's). */
  native?: boolean;
}

interface Item {
  value: string;
  label: string;
  disabled: boolean;
  group?: string;
  /** Its index among the select's own options. */
  index: number;
}

function itemsOf(select: HTMLSelectElement): Item[] {
  return Array.from(select.options)
    .filter((o) => !o.hidden)
    .map((o) => {
      const group = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement : null;
      return { value: o.value, label: o.label || o.text, disabled: o.disabled || !!group?.disabled, group: group?.label, index: o.index };
    });
}

/** What the select is called, for the list's own name. */
function nameOf(select: HTMLSelectElement): string | undefined {
  return select.getAttribute("aria-label") || select.labels?.[0]?.textContent?.trim() || select.title || undefined;
}

const KEYS_THAT_OPEN = new Set([" ", "Enter", "ArrowDown", "ArrowUp", "F4"]);

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, native, onMouseDown, onPointerDown, onKeyDown, ...props },
  ref,
) {
  const select = useRef<HTMLSelectElement | null>(null);
  const setRef = useCallback(
    (el: HTMLSelectElement | null) => {
      select.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [chosen, setChosen] = useState(-1);
  const [active, setActive] = useState(-1);
  const [label, setLabel] = useState<string>();
  const pointer = useRef("mouse");
  const typed = useRef({ text: "", at: 0 });
  const custom = !native && !props.multiple && !(props.size && props.size > 1);

  const optionId = (i: number) => `${listId}-o${i}`;
  const focusOption = (i: number, scroll = true) => {
    const el = document.getElementById(optionId(i));
    el?.focus({ preventScroll: true });
    if (scroll) el?.scrollIntoView({ block: "nearest" });
  };
  const move = (i: number, scroll = true) => {
    if (i < 0) return;
    setActive(i);
    focusOption(i, scroll);
  };

  const show = () => {
    const el = select.current;
    if (!el) return;
    const list = itemsOf(el);
    if (!list.length) return;
    const current = list.findIndex((o) => o.index === el.selectedIndex);
    setItems(list);
    setChosen(current);
    setActive(current >= 0 && !list[current].disabled ? current : nextEnabled(list, -1, 1));
    setLabel(nameOf(el));
    typed.current = { text: "", at: 0 };
    setOpen(true);
  };

  /** Picks like the browser does: the option becomes selected, then input and change fire, so onChange runs. */
  const pick = (i: number) => {
    const el = select.current;
    const item = items[i];
    setOpen(false);
    if (!el || !item || item.disabled || el.selectedIndex === item.index) return;
    el.selectedIndex = item.index;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const page = 10;
    const to: Record<string, () => number> = {
      ArrowDown: () => nextEnabled(items, active, 1),
      ArrowUp: () => nextEnabled(items, active, -1),
      Home: () => nextEnabled(items, -1, 1),
      End: () => nextEnabled(items, items.length, -1),
      PageDown: () => nextEnabled(items, active, page),
      PageUp: () => nextEnabled(items, active, -page),
    };
    if (to[e.key]) {
      e.preventDefault();
      move(to[e.key]());
      return;
    }
    const now = Date.now();
    // Space picks, unless it's part of a name being typed ("New York").
    const typing = now - typed.current.at <= 700;
    if (e.key === "Enter" || (e.key === " " && !typing)) {
      e.preventDefault();
      pick(active);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const text = typing ? typed.current.text + e.key : e.key;
      typed.current = { text, at: now };
      move(typeahead(items, text, active));
    }
  };

  const field = cn(fieldClass, "h-9 w-auto", className, "field-select pr-9");
  if (!custom) {
    return (
      <select ref={setRef} className={field} onMouseDown={onMouseDown} onPointerDown={onPointerDown} onKeyDown={onKeyDown} {...props}>
        {children}
      </select>
    );
  }

  return (
    <RP.Root open={open} onOpenChange={setOpen} modal>
      <RP.Anchor asChild>
        <select
          ref={setRef}
          className={field}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onPointerDown={(e: PointerEvent<HTMLSelectElement>) => {
            onPointerDown?.(e);
            pointer.current = e.pointerType;
          }}
          onMouseDown={(e: MouseEvent<HTMLSelectElement>) => {
            onMouseDown?.(e);
            // A touch keeps the phone's own picker. A mouse opens this list instead of the browser's.
            if (e.defaultPrevented || e.button !== 0 || pointer.current === "touch" || props.disabled) return;
            e.preventDefault();
            e.currentTarget.focus();
            show();
          }}
          onKeyDown={(e: KeyboardEvent<HTMLSelectElement>) => {
            onKeyDown?.(e);
            if (e.defaultPrevented || e.metaKey || e.ctrlKey || !KEYS_THAT_OPEN.has(e.key)) return;
            e.preventDefault();
            show();
          }}
          {...props}
        >
          {children}
        </select>
      </RP.Anchor>
      <RP.Portal>
        <RP.Content
          id={listId}
          role="listbox"
          aria-label={label}
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            focusOption(active);
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            select.current?.focus();
          }}
          onKeyDown={onListKey}
          className={cn(
            "z-[80] max-h-[min(320px,var(--radix-popover-content-available-height))] min-w-[var(--radix-popover-trigger-width)] max-w-[min(420px,calc(100vw-24px))] overflow-y-auto overscroll-contain rounded-xl bg-surface-raised p-1 shadow-lg ring-1 ring-inset ring-border outline-none",
            "origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-[pop-in_140ms_var(--ease-out)] data-[state=closed]:animate-[pop-out_100ms_var(--ease-out)]",
          )}
        >
          {items.map((item, i) => (
            <Fragment key={item.index}>
              {item.group !== undefined && item.group !== items[i - 1]?.group && (
                <div role="presentation" className="px-2.5 pb-1 pt-2 text-[12px] font-medium text-fg-3 first:pt-1">
                  {item.group}
                </div>
              )}
              <div
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={i === chosen}
                aria-disabled={item.disabled || undefined}
                data-active={i === active || undefined}
                title={item.label.length > 48 ? item.label : undefined}
                onPointerMove={() => {
                  if (!item.disabled && i !== active) move(i, false);
                }}
                onClick={() => pick(i)}
                className={cn(
                  "flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] leading-5 text-fg outline-none transition-colors duration-75",
                  "data-[active]:bg-bg-subtle aria-disabled:cursor-not-allowed aria-disabled:text-fg-4",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <Check aria-hidden className={cn("size-3.5 shrink-0 text-fg-2", i === chosen ? "opacity-100" : "opacity-0")} />
              </div>
            </Fragment>
          ))}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
});
