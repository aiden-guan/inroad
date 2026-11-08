"use client";

import { motion, useMotionTemplate, useReducedMotion, useSpring } from "motion/react";
import { useId, useMemo, type ReactNode, type PointerEvent } from "react";
import { cn } from "@/lib/client/cn";

/**
 * Generative ink: a pattern drawn from a seed (a domain, a quarter, a question), so every company and every
 * answer carries its own mark and the same seed always draws the same mark. Ink only, in `currentColor`:
 * the agent's blue stays the agent's.
 */

export type InkFamily = "tile" | "arches" | "waves" | "lattice" | "halftone";
const FAMILIES: InkFamily[] = ["tile", "arches", "waves", "lattice", "halftone"];

function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and the same everywhere. */
function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)];
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const round = (n: number) => Math.round(n * 100) / 100;

interface Tile {
  w: number;
  h: number;
  rotate: number;
  body: ReactNode;
}

/** Azulejo-like: quarter circles meet at the corners, a motif holds the middle, small marks on the edges. */
function tile(r: () => number): Tile {
  const s = pick(r, [34, 38, 42, 46]);
  const c = s / 2;
  const corner = round(s * between(r, 0.2, 0.36));
  const ringed = r() > 0.5;
  const motif = pick(r, ["quatrefoil", "star", "diamond", "rings"] as const);
  const edge = pick(r, ["dots", "none", "ticks"] as const);
  const sw = 1.4;
  const corners = [
    [0, 0],
    [s, 0],
    [0, s],
    [s, s],
  ];
  return {
    w: s,
    h: s,
    rotate: r() > 0.7 ? 45 : 0,
    body: (
      <>
        {corners.map(([x, y], i) =>
          ringed ? (
            <g key={i} fill="none" stroke="currentColor" strokeWidth={sw}>
              <circle cx={x} cy={y} r={corner} />
              <circle cx={x} cy={y} r={round(corner * 0.55)} />
            </g>
          ) : (
            <circle key={i} cx={x} cy={y} r={corner} fill="currentColor" />
          ),
        )}
        {motif === "quatrefoil" && (
          <g fill="none" stroke="currentColor" strokeWidth={sw}>
            {[
              [c - s * 0.12, c],
              [c + s * 0.12, c],
              [c, c - s * 0.12],
              [c, c + s * 0.12],
            ].map(([x, y], i) => (
              <circle key={i} cx={round(x)} cy={round(y)} r={round(s * 0.12)} />
            ))}
          </g>
        )}
        {motif === "star" && (
          <g fill="currentColor">
            <rect x={round(c - s * 0.13)} y={round(c - s * 0.13)} width={round(s * 0.26)} height={round(s * 0.26)} />
            <rect x={round(c - s * 0.13)} y={round(c - s * 0.13)} width={round(s * 0.26)} height={round(s * 0.26)} transform={`rotate(45 ${c} ${c})`} />
          </g>
        )}
        {motif === "diamond" && (
          <>
            <path d={`M${c} ${round(c - s * 0.22)}L${round(c + s * 0.22)} ${c}L${c} ${round(c + s * 0.22)}L${round(c - s * 0.22)} ${c}Z`} fill="none" stroke="currentColor" strokeWidth={sw} />
            <circle cx={c} cy={c} r={round(s * 0.05)} fill="currentColor" />
          </>
        )}
        {motif === "rings" && (
          <g fill="none" stroke="currentColor" strokeWidth={sw}>
            <circle cx={c} cy={c} r={round(s * 0.2)} />
            <circle cx={c} cy={c} r={round(s * 0.09)} fill="currentColor" />
          </g>
        )}
        {edge === "dots" &&
          [
            [c, 0],
            [c, s],
            [0, c],
            [s, c],
          ].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={round(s * 0.045)} fill="currentColor" />)}
        {edge === "ticks" && (
          <path d={`M${c} 0v${round(s * 0.1)}M${c} ${s}v-${round(s * 0.1)}M0 ${c}h${round(s * 0.1)}M${s} ${c}h-${round(s * 0.1)}`} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
        )}
      </>
    ),
  };
}

/** Nested arches in a running bond: the Inroad mark's two paths, repeated into a facade. */
function arches(r: () => number): Tile {
  const w = pick(r, [26, 30, 34]);
  const h = round(w * between(r, 0.95, 1.25));
  const nests = pick(r, [1, 2, 3]);
  const gap = round(w * 0.14);
  const sw = 1.4;
  const arch = (x0: number, y0: number, key: string) => (
    <g key={key}>
      {Array.from({ length: nests }, (_, k) => {
        const l = round(x0 + 3 + k * gap);
        const rr = round(x0 + w - 3 - k * gap);
        const rad = round((rr - l) / 2);
        if (rad <= 1) return null;
        const top = round(y0 + 4 + k * gap + rad);
        return <path key={k} d={`M${l} ${y0 + h}V${top}A${rad} ${rad} 0 0 1 ${rr} ${top}V${y0 + h}`} />;
      })}
    </g>
  );
  return {
    w,
    h: h * 2,
    rotate: 0,
    body: (
      <g fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round">
        {arch(0, 0, "a")}
        {arch(-w / 2, h, "b")}
        {arch(w / 2, h, "c")}
      </g>
    ),
  };
}

/** Contour lines: the rhythm of a map, never the same twice. */
function waves(r: () => number): Tile {
  const period = pick(r, [48, 60, 72, 84]);
  const lines = pick(r, [3, 4, 5]);
  const gap = pick(r, [7, 8, 9]);
  const amp = round(between(r, 2.5, 6.5));
  return {
    w: period,
    h: lines * gap,
    rotate: round(between(r, -14, 14)),
    body: (
      <g fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round">
        {Array.from({ length: lines }, (_, i) => {
          const y = round(gap / 2 + i * gap);
          const a = round(amp * (0.6 + (i % 2) * 0.4));
          return <path key={i} d={`M0 ${y}Q${period / 4} ${round(y - a * 2)} ${period / 2} ${y}T${period} ${y}`} />;
        })}
      </g>
    ),
  };
}

/** A Swiss lattice: crosses and dots on a grid, every other one turned. */
function lattice(r: () => number): Tile {
  const s = pick(r, [22, 26, 30]);
  const arm = round(s * between(r, 0.16, 0.26));
  const turned = r() > 0.5;
  const dot = round(s * 0.06);
  const cross = (x: number, y: number, rot: number) => (
    <path d={`M${x - arm} ${y}H${x + arm}M${x} ${y - arm}V${y + arm}`} transform={rot ? `rotate(${rot} ${x} ${y})` : undefined} />
  );
  return {
    w: s * 2,
    h: s * 2,
    rotate: 0,
    body: (
      <>
        <g stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
          {cross(s / 2, s / 2, 0)}
          {cross(s * 1.5, s * 1.5, turned ? 45 : 0)}
        </g>
        <g fill="currentColor">
          <circle cx={s * 1.5} cy={s / 2} r={dot} />
          <circle cx={s / 2} cy={s * 1.5} r={dot} />
        </g>
      </>
    ),
  };
}

/** Halftone: dots swell along a seeded field, like ink soaking into paper. Not a repeat; drawn once at size. */
function halftone(r: () => number, width: number, height: number) {
  const step = 9;
  const fx = between(r, 0.012, 0.03);
  const fy = between(r, 0.02, 0.05);
  const p1 = r() * Math.PI * 2;
  const p2 = r() * Math.PI * 2;
  const lean = r() > 0.5 ? 1 : -1;
  const dots: ReactNode[] = [];
  for (let y = step / 2, row = 0; y < height; y += step, row++) {
    for (let x = (row % 2 ? step / 2 : 0) + step / 2; x < width; x += step) {
      const field = 0.5 + 0.5 * Math.sin(x * fx + p1) * Math.cos(y * fy + p2);
      const ramp = lean > 0 ? x / width : 1 - x / width;
      const v = Math.max(0, field * 0.55 + ramp * 0.6 - 0.18);
      const rad = round(Math.min(step * 0.48, v * step * 0.52));
      if (rad > 0.35) dots.push(<circle key={`${x}-${y}`} cx={round(x)} cy={round(y)} r={rad} />);
    }
  }
  return <g fill="currentColor">{dots}</g>;
}

function familyFor(seed: string, family?: InkFamily): InkFamily {
  return family ?? FAMILIES[hash(`${seed}·family`) % FAMILIES.length];
}

/**
 * The pattern itself, filling its box. `reveal` inks it in with a soft diagonal edge; otherwise it's simply there.
 * Halftone is drawn at `width`×`height` (scaled to cover); the rest repeat a tile.
 */
export function InkPattern({
  seed,
  family,
  reveal,
  delay = 0,
  scale = 1,
  width = 720,
  height = 160,
  className,
}: {
  seed: string;
  family?: InkFamily;
  reveal?: boolean;
  delay?: number;
  /** Tile size multiplier: banners read better with bigger tiles. */
  scale?: number;
  width?: number;
  height?: number;
  className?: string;
}) {
  const id = `ink${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const kind = familyFor(seed, family);
  const drawn = useMemo(() => {
    const r = rng(`${seed}·${kind}`);
    if (kind === "halftone") return { halftone: halftone(r, width, height) };
    const t = kind === "tile" ? tile(r) : kind === "arches" ? arches(r) : kind === "waves" ? waves(r) : lattice(r);
    return { tile: t };
  }, [seed, kind, width, height]);

  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 h-full w-full", reveal && "fx-ink", className)}
      style={reveal ? ({ "--fx-delay": `${delay}ms` } as React.CSSProperties) : undefined}
      viewBox={drawn.halftone ? `0 0 ${width} ${height}` : undefined}
      preserveAspectRatio={drawn.halftone ? "xMidYMid slice" : undefined}
    >
      {drawn.tile ? (
        <>
          <defs>
            <pattern
              id={id}
              width={drawn.tile.w}
              height={drawn.tile.h}
              patternUnits="userSpaceOnUse"
              patternTransform={[scale !== 1 && `scale(${scale})`, drawn.tile.rotate && `rotate(${drawn.tile.rotate})`].filter(Boolean).join(" ") || undefined}
            >
              {drawn.tile.body}
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${id})`} />
        </>
      ) : (
        drawn.halftone
      )}
    </svg>
  );
}

/**
 * A banner of generative ink that dissolves into the card below it, with the title set on the paper.
 * On a fine pointer the pattern drifts a few pixels after the cursor, on a spring (decoration, so it may).
 */
export function InkBanner({
  seed,
  family,
  reveal,
  delay,
  scale = 1.4,
  className,
  inkClassName,
  children,
}: {
  seed: string;
  family?: InkFamily;
  reveal?: boolean;
  delay?: number;
  scale?: number;
  className?: string;
  /** Pattern opacity/color, e.g. "text-fg opacity-30". */
  inkClassName?: string;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 120, damping: 20, mass: 0.6 });
  const y = useSpring(0, { stiffness: 120, damping: 20, mass: 0.6 });
  const transform = useMotionTemplate`translate3d(${x}px, ${y}px, 0) scale(1.06)`;
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const box = e.currentTarget.getBoundingClientRect();
    x.set(((e.clientX - box.left) / box.width - 0.5) * -10);
    y.set(((e.clientY - box.top) / box.height - 0.5) * -6);
  };
  return (
    <div
      onPointerMove={onMove}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      className={cn("relative isolate overflow-hidden", className)}
    >
      <motion.div aria-hidden className={cn("absolute inset-0 -z-10 text-fg", inkClassName ?? "opacity-[0.16]")} style={{ transform }}>
        <InkPattern seed={seed} family={family} reveal={reveal} delay={delay} scale={scale} />
      </motion.div>
      {children}
    </div>
  );
}
