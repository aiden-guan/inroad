/**
 * Marks for tools whose own site doesn't give /api/favicon a raster icon it can serve (an SVG-only favicon is
 * never served from this origin, see src/lib/signals/icons.ts), drawn here so they always load, offline too.
 * Inline React SVG, so nothing is fetched and no third party learns anything.
 */
import type { ReactElement } from "react";

function Stripe() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <rect width="24" height="24" rx="5" fill="#635BFF" />
      <path
        transform="translate(4.4 4.4) scale(0.633)"
        fill="#fff"
        d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"
      />
    </svg>
  );
}

/** The hedgehog: blue, yellow and red quills on a slope, a dark head with one eye. */
function PostHog() {
  const band = (x: number, y: number, fill: string, h = 6) => <path key={`${x}-${y}`} d={`M${x} ${y}l9 9v${h}l-9-9z`} fill={fill} />;
  return (
    <svg viewBox="-1 -1 50 32" className="h-[13px] w-[21px]" aria-hidden>
      {band(0, 3, "#1D4AFF")}
      {band(0, 13, "#1D4AFF")}
      <path d="M0 23l6 6H0z" fill="#1D4AFF" />
      {band(10, 3, "#F9BD2B")}
      {band(10, 13, "#F9BD2B")}
      <path d="M10 23l6 6h-6z" fill="#F9BD2B" />
      {band(20, 3, "#F54E00")}
      {band(20, 13, "#F54E00")}
      <path d="M20 23l6 6h-6z" fill="#F54E00" />
      <path d="M31 13.5l11.6 11.6c1.4 1.4 3.2 2.2 5.4 2.4V30H31z" className="fill-fg" />
      <circle cx="36.4" cy="25.2" r="1.7" className="fill-surface" />
    </svg>
  );
}

/** Polar's mark: a sphere drawn as its outline and one meridian. */
function Polar() {
  return (
    <svg viewBox="0 0 24 24" className="size-[17px]" aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="none" className="stroke-fg" strokeWidth="1.8" />
      <ellipse cx="10.4" cy="12" rx="4.2" ry="9.5" fill="none" className="stroke-fg" strokeWidth="1.8" />
    </svg>
  );
}

const MARKS: Record<string, () => ReactElement> = {
  "stripe.com": Stripe,
  "posthog.com": PostHog,
  "polar.sh": Polar,
};

/** The bundled mark for a tool's domain, if there is one. */
export function bundledMark(domain: string | undefined): ReactElement | null {
  const Mark = domain ? MARKS[domain.toLowerCase()] : undefined;
  return Mark ? <Mark /> : null;
}
