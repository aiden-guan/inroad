/**
 * Geo checks. Run: npx tsx --conditions=react-server src/lib/geo/geo.test.ts
 * Plain node:assert: the place parser on the strings LinkedIn, Apollo and founders actually write,
 * the geometry, lead placement, metros, and the "dinner neighbors" move.
 */
import assert from "node:assert/strict";
import { computeMoves } from "@/lib/moves/rules";
import { sampleWorkspace } from "@/lib/sample";
import { leadPoints, metros, nearby } from "./leads";
import { circleRing, distanceKm, formatDistance, placeLabel, resolvePlace, searchPlaces, spread } from "./places";

const results: string[] = [];
function check(name: string, fn: () => void) {
  fn();
  results.push(name);
  console.log(`  ok   ${name}`);
}
const label = (s: string) => {
  const p = resolvePlace(s);
  return p ? placeLabel(p) : null;
};

console.log("geo");

check("LinkedIn-style places resolve to the right city", () => {
  assert.equal(label("Greater New York City Area"), "New York, NY");
  assert.equal(label("San Francisco Bay Area"), "San Francisco, CA");
  assert.equal(label("Brooklyn, NY"), "New York, NY");
  assert.equal(label("SoMa, San Francisco"), "San Francisco, CA");
  assert.equal(label("Palo Alto, California, United States"), "Palo Alto, CA");
  assert.equal(label("Bengaluru, Karnataka, India"), "Bangalore, IN");
  assert.equal(label("Tel Aviv-Yafo, Israel"), "Tel Aviv, IL");
  assert.equal(label("Washington, DC"), "Washington DC");
});

check("same-name cities follow the hint in the text", () => {
  assert.equal(label("Cambridge, MA"), "Cambridge, MA");
  assert.equal(label("Cambridge, United Kingdom"), "Cambridge, GB");
  assert.equal(label("London, Ontario, Canada"), "London, ON");
  assert.equal(label("London, England, United Kingdom"), "London, GB");
  assert.equal(label("Portland, ME"), "Portland, ME");
  assert.equal(label("Portland, Oregon"), "Portland, OR");
});

check("states, remote and short words never pose as cities", () => {
  assert.equal(label("Albany, New York"), null, "New York the state is not New York the city");
  assert.equal(label("Spokane, Washington"), null, "Washington the state is not DC");
  assert.equal(label("Remote (US)"), null);
  assert.equal(label("Lagos, Nigeria"), "Lagos, NG", "'la' inside a word isn't Los Angeles");
  assert.equal(label(""), null);
});

check("distance, the radius ring and the city-level spread", () => {
  const ny = resolvePlace("New York")!;
  const sf = resolvePlace("San Francisco")!;
  assert.ok(Math.abs(distanceKm(ny, sf) - 4129) < 10, "great-circle NY to SF is about 4,129 km");
  const ring = circleRing(ny, 40);
  assert.deepEqual(ring[0], ring.at(-1), "the ring closes");
  for (const [lng, lat] of ring) assert.ok(Math.abs(distanceKm(ny, { lat, lng }) - 40) < 0.05);
  const a = spread("per:1", ny);
  assert.deepEqual(a, spread("per:1", ny), "deterministic");
  assert.ok(distanceKm(ny, a) <= 3.01, "within 3 km of the center");
  assert.equal(formatDistance(0.4, true), "<1 mi");
  assert.equal(formatDistance(16.09, true), "10 mi");
});

check("search suggests by prefix and alias, without duplicates", () => {
  assert.deepEqual(searchPlaces("bengal").map(placeLabel), ["Bangalore, IN"]);
  assert.ok(searchPlaces("san").map(placeLabel).includes("San Francisco, CA"));
  assert.equal(searchPlaces("c").length, 0, "one letter is too vague");
});

check("leads are people by their own city, else by HQ; companies only when nobody is named", () => {
  const ws = sampleWorkspace(new Date("2026-10-21T10:00:00"));
  const { points } = leadPoints(ws, resolvePlace);
  const sofia = points.find((p) => p.personId === "per_sofia_reyes");
  assert.equal(sofia?.place, "Lisbon, PT", "her own location wins over Northwind's HQ");
  assert.equal(sofia?.byHq, false);
  assert.ok(points.some((p) => p.kind === "account" && p.domain === "quayside.example"), "no people yet: the company itself");
  assert.ok(!points.some((p) => p.domain === "ironvale.example"), "disqualified companies stay off the map");
  for (const p of points) assert.ok(!(p.kind === "account" && points.some((q) => q.kind === "person" && q.domain === p.domain)));
});

check("nearby ranks pipeline, then warm, then fit; metros fold neighbors in", () => {
  const ws = sampleWorkspace(new Date("2026-10-21T10:00:00"));
  const { points } = leadPoints(ws, resolvePlace);
  const ny = resolvePlace("New York")!;
  const near = nearby(points, ny, 40);
  assert.ok(near.length >= 8);
  assert.ok(near.every((p) => p.km <= 40));
  const firstProspect = near.findIndex((p) => p.group !== "pipeline");
  assert.ok(near.slice(firstProspect).every((p) => p.group !== "pipeline"), "pipeline first");
  const m = metros(points);
  assert.equal(m[0].place, "New York, NY");
  assert.ok(!m.some((x) => x.place === "Jersey City, NJ"), "Jersey City folds into New York");
});

check("an upcoming dinner with warm leads nearby who aren't invited becomes a move", () => {
  const ws = sampleWorkspace(new Date("2026-10-21T10:00:00"));
  const ev = Object.values(ws.events).find((e) => e.kind === "dinner")!;
  // Clear the list so the warm New York leads are all uninvited.
  ev.guests = {};
  const moves = computeMoves(ws, new Date("2026-10-21T10:00:00"));
  const m = moves.find((x) => x.id === `mv_event_nearby_${ev.id}`);
  assert.ok(m, "the move exists");
  assert.match(m!.title, /near your New York dinner/);
  assert.equal(m!.href, `/events/${ev.id}?tab=nearby`);
});

console.log(`\nall passing (${results.length})`);
