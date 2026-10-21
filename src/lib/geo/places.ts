/**
 * Places in code (zero network): a gazetteer of the cities where startups and their buyers are, the
 * parser that turns "Greater New York City Area" or "Cambridge, MA" into coordinates, and the
 * geometry the map needs (distance, a radius ring, a gentle spread for city-level pins).
 * Pure and dependency-free, so the browser and the server place a lead the same way.
 */

export interface Place {
  /** "New York" */
  name: string;
  /** ISO 3166-1 alpha-2, for Apollo's "City, US" format and disambiguation. */
  country: string;
  /** State or region hint ("CA", "MA", "England"), when a name is shared. */
  region?: string;
  lat: number;
  lng: number;
}

export interface ResolvedPlace extends Place {
  /** How exact the coordinates are: the center of a city, or a geocoded address. */
  precision: "city" | "address";
}

type Row = [name: string, country: string, lat: number, lng: number, aliases?: string[], region?: string];

// Coordinates are city centers. Aliases are lowercase. Order matters only between same-name cities:
// the first is the default when nothing in the text says otherwise.
const ROWS: Row[] = [
  // United States
  ["New York", "US", 40.7128, -74.006, ["nyc", "new york city", "manhattan", "brooklyn", "queens", "the bronx", "long island city", "new york city metropolitan", "greater new york"], "NY"],
  ["Jersey City", "US", 40.7178, -74.0431, ["hoboken"], "NJ"],
  ["Newark", "US", 40.7357, -74.1724, [], "NJ"],
  ["Princeton", "US", 40.3573, -74.6672, [], "NJ"],
  ["Stamford", "US", 41.0534, -73.5387, ["greenwich"], "CT"],
  ["New Haven", "US", 41.3083, -72.9279, [], "CT"],
  ["San Francisco", "US", 37.7749, -122.4194, ["sf", "san francisco bay area", "bay area", "sf bay area", "silicon valley"], "CA"],
  ["Oakland", "US", 37.8044, -122.2712, [], "CA"],
  ["Berkeley", "US", 37.8715, -122.273, [], "CA"],
  ["Palo Alto", "US", 37.4419, -122.143, ["stanford"], "CA"],
  ["Mountain View", "US", 37.3861, -122.0839, [], "CA"],
  ["Menlo Park", "US", 37.453, -122.1817, [], "CA"],
  ["San Mateo", "US", 37.563, -122.3255, ["foster city"], "CA"],
  ["Redwood City", "US", 37.4852, -122.2364, [], "CA"],
  ["Burlingame", "US", 37.5841, -122.3661, ["south san francisco"], "CA"],
  ["San Jose", "US", 37.3382, -121.8863, [], "CA"],
  ["Sunnyvale", "US", 37.3688, -122.0363, [], "CA"],
  ["Cupertino", "US", 37.323, -122.0322, [], "CA"],
  ["Santa Clara", "US", 37.3541, -121.9552, [], "CA"],
  ["Los Angeles", "US", 34.0522, -118.2437, ["la", "greater los angeles", "hollywood", "venice", "playa vista"], "CA"],
  ["Santa Monica", "US", 34.0195, -118.4912, [], "CA"],
  ["Culver City", "US", 34.0211, -118.3965, [], "CA"],
  ["Pasadena", "US", 34.1478, -118.1445, [], "CA"],
  ["Irvine", "US", 33.6846, -117.8265, ["orange county", "newport beach", "costa mesa"], "CA"],
  ["San Diego", "US", 32.7157, -117.1611, ["la jolla"], "CA"],
  ["Santa Barbara", "US", 34.4208, -119.6982, [], "CA"],
  ["Sacramento", "US", 38.5816, -121.4944, [], "CA"],
  ["Seattle", "US", 47.6062, -122.3321, ["greater seattle"], "WA"],
  ["Bellevue", "US", 47.6101, -122.2015, [], "WA"],
  ["Redmond", "US", 47.674, -122.1215, [], "WA"],
  ["Kirkland", "US", 47.6769, -122.206, [], "WA"],
  ["Portland", "US", 45.5152, -122.6784, [], "OR"],
  ["Portland", "US", 43.6591, -70.2568, [], "ME"],
  ["Boise", "US", 43.615, -116.2023, [], "ID"],
  ["Boston", "US", 42.3601, -71.0589, ["greater boston"], "MA"],
  ["Cambridge", "US", 42.3736, -71.1097, ["kendall square"], "MA"],
  ["Cambridge", "GB", 52.2053, 0.1218, [], "England"],
  ["Somerville", "US", 42.3876, -71.0995, [], "MA"],
  ["Providence", "US", 41.824, -71.4128, [], "RI"],
  ["Washington DC", "US", 38.9072, -77.0369, ["washington, dc", "washington d.c.", "washington, d.c.", "dc", "d.c.", "dmv"], "DC"],
  ["Arlington", "US", 38.8816, -77.091, [], "VA"],
  ["Reston", "US", 38.9586, -77.357, ["tysons", "herndon"], "VA"],
  ["McLean", "US", 38.9339, -77.1773, [], "VA"],
  ["Bethesda", "US", 38.9847, -77.0947, [], "MD"],
  ["Baltimore", "US", 39.2904, -76.6122, [], "MD"],
  ["Richmond", "US", 37.5407, -77.436, [], "VA"],
  ["Philadelphia", "US", 39.9526, -75.1652, ["philly"], "PA"],
  ["Pittsburgh", "US", 40.4406, -79.9959, [], "PA"],
  ["Chicago", "US", 41.8781, -87.6298, ["greater chicago"], "IL"],
  ["Detroit", "US", 42.3314, -83.0458, [], "MI"],
  ["Ann Arbor", "US", 42.2808, -83.743, [], "MI"],
  ["Minneapolis", "US", 44.9778, -93.265, ["saint paul", "st. paul", "twin cities"], "MN"],
  ["Madison", "US", 43.0731, -89.4012, [], "WI"],
  ["Milwaukee", "US", 43.0389, -87.9065, [], "WI"],
  ["Columbus", "US", 39.9612, -82.9988, [], "OH"],
  ["Cleveland", "US", 41.4993, -81.6944, [], "OH"],
  ["Cincinnati", "US", 39.1031, -84.512, [], "OH"],
  ["Indianapolis", "US", 39.7684, -86.1581, [], "IN"],
  ["St. Louis", "US", 38.627, -90.1994, ["saint louis"], "MO"],
  ["Kansas City", "US", 39.0997, -94.5786, [], "MO"],
  ["Austin", "US", 30.2672, -97.7431, [], "TX"],
  ["Dallas", "US", 32.7767, -96.797, ["fort worth", "dfw", "plano", "irving"], "TX"],
  ["Houston", "US", 29.7604, -95.3698, [], "TX"],
  ["San Antonio", "US", 29.4241, -98.4936, [], "TX"],
  ["Denver", "US", 39.7392, -104.9903, ["greater denver"], "CO"],
  ["Boulder", "US", 40.015, -105.2705, [], "CO"],
  ["Salt Lake City", "US", 40.7608, -111.891, ["slc"], "UT"],
  ["Lehi", "US", 40.3916, -111.8508, ["provo", "silicon slopes"], "UT"],
  ["Phoenix", "US", 33.4484, -112.074, ["tempe"], "AZ"],
  ["Scottsdale", "US", 33.4942, -111.9261, [], "AZ"],
  ["Las Vegas", "US", 36.1699, -115.1398, [], "NV"],
  ["Albuquerque", "US", 35.0844, -106.6504, [], "NM"],
  ["Miami", "US", 25.7617, -80.1918, ["miami beach", "south florida"], "FL"],
  ["Fort Lauderdale", "US", 26.1224, -80.1373, ["boca raton"], "FL"],
  ["Tampa", "US", 27.9506, -82.4572, [], "FL"],
  ["Orlando", "US", 28.5383, -81.3792, [], "FL"],
  ["Atlanta", "US", 33.749, -84.388, ["greater atlanta"], "GA"],
  ["Raleigh", "US", 35.7796, -78.6382, ["research triangle"], "NC"],
  ["Durham", "US", 35.994, -78.8986, [], "NC"],
  ["Charlotte", "US", 35.2271, -80.8431, [], "NC"],
  ["Nashville", "US", 36.1627, -86.7816, [], "TN"],
  ["New Orleans", "US", 29.9511, -90.0715, [], "LA"],
  ["Birmingham", "US", 33.5186, -86.8104, [], "AL"],
  ["Honolulu", "US", 21.3069, -157.8583, [], "HI"],
  // Canada
  ["Toronto", "CA", 43.6532, -79.3832, ["greater toronto", "gta"], "ON"],
  ["Waterloo", "CA", 43.4643, -80.5204, ["kitchener"], "ON"],
  ["Ottawa", "CA", 45.4215, -75.6972, [], "ON"],
  ["London", "CA", 42.9849, -81.2453, [], "ON"],
  ["Montreal", "CA", 45.5017, -73.5673, ["montréal"], "QC"],
  ["Quebec City", "CA", 46.8139, -71.208, ["québec"], "QC"],
  ["Vancouver", "CA", 49.2827, -123.1207, [], "BC"],
  ["Calgary", "CA", 51.0447, -114.0719, [], "AB"],
  ["Edmonton", "CA", 53.5461, -113.4938, [], "AB"],
  // Latin America
  ["Mexico City", "MX", 19.4326, -99.1332, ["cdmx", "ciudad de méxico"]],
  ["Guadalajara", "MX", 20.6597, -103.3496],
  ["Monterrey", "MX", 25.6866, -100.3161],
  ["São Paulo", "BR", -23.5505, -46.6333, ["sao paulo"]],
  ["Rio de Janeiro", "BR", -22.9068, -43.1729],
  ["Buenos Aires", "AR", -34.6037, -58.3816],
  ["Santiago", "CL", -33.4489, -70.6693],
  ["Bogotá", "CO", 4.711, -74.0721, ["bogota"]],
  ["Medellín", "CO", 6.2442, -75.5812, ["medellin"]],
  ["Lima", "PE", -12.0464, -77.0428],
  // Europe
  ["London", "GB", 51.5074, -0.1278, ["greater london", "london area"], "England"],
  ["Oxford", "GB", 51.752, -1.2577, [], "England"],
  ["Manchester", "GB", 53.4808, -2.2426, [], "England"],
  ["Birmingham", "GB", 52.4862, -1.8904, [], "England"],
  ["Bristol", "GB", 51.4545, -2.5879, [], "England"],
  ["Leeds", "GB", 53.8008, -1.5491, [], "England"],
  ["Edinburgh", "GB", 55.9533, -3.1883, [], "Scotland"],
  ["Glasgow", "GB", 55.8642, -4.2518, [], "Scotland"],
  ["Belfast", "GB", 54.5973, -5.9301, [], "Northern Ireland"],
  ["Dublin", "IE", 53.3498, -6.2603],
  ["Paris", "FR", 48.8566, 2.3522, ["île-de-france", "ile-de-france"]],
  ["Lyon", "FR", 45.764, 4.8357],
  ["Nice", "FR", 43.7102, 7.262, ["sophia antipolis"]],
  ["Bordeaux", "FR", 44.8378, -0.5792],
  ["Toulouse", "FR", 43.6047, 1.4442],
  ["Berlin", "DE", 52.52, 13.405],
  ["Munich", "DE", 48.1351, 11.582, ["münchen", "muenchen"]],
  ["Hamburg", "DE", 53.5511, 9.9937],
  ["Frankfurt", "DE", 50.1109, 8.6821],
  ["Cologne", "DE", 50.9375, 6.9603, ["köln", "koln"]],
  ["Düsseldorf", "DE", 51.2277, 6.7735, ["dusseldorf"]],
  ["Stuttgart", "DE", 48.7758, 9.1829],
  ["Amsterdam", "NL", 52.3676, 4.9041],
  ["Rotterdam", "NL", 51.9244, 4.4777],
  ["Utrecht", "NL", 52.0907, 5.1214],
  ["The Hague", "NL", 52.0705, 4.3007, ["den haag"]],
  ["Eindhoven", "NL", 51.4416, 5.4697],
  ["Brussels", "BE", 50.8503, 4.3517, ["bruxelles", "brussel"]],
  ["Antwerp", "BE", 51.2194, 4.4025],
  ["Luxembourg", "LU", 49.6116, 6.1319],
  ["Zurich", "CH", 47.3769, 8.5417, ["zürich"]],
  ["Geneva", "CH", 46.2044, 6.1432, ["genève"]],
  ["Basel", "CH", 47.5596, 7.5886],
  ["Lausanne", "CH", 46.5197, 6.6323],
  ["Vienna", "AT", 48.2082, 16.3738, ["wien"]],
  ["Prague", "CZ", 50.0755, 14.4378, ["praha"]],
  ["Warsaw", "PL", 52.2297, 21.0122, ["warszawa"]],
  ["Kraków", "PL", 50.0647, 19.945, ["krakow"]],
  ["Budapest", "HU", 47.4979, 19.0402],
  ["Bucharest", "RO", 44.4268, 26.1025],
  ["Sofia", "BG", 42.6977, 23.3219],
  ["Belgrade", "RS", 44.7866, 20.4489],
  ["Zagreb", "HR", 45.815, 15.9819],
  ["Athens", "GR", 37.9838, 23.7275],
  ["Istanbul", "TR", 41.0082, 28.9784],
  ["Kyiv", "UA", 50.4501, 30.5234, ["kiev"]],
  ["Stockholm", "SE", 59.3293, 18.0686],
  ["Copenhagen", "DK", 55.6761, 12.5683, ["københavn"]],
  ["Oslo", "NO", 59.9139, 10.7522],
  ["Helsinki", "FI", 60.1699, 24.9384],
  ["Tallinn", "EE", 59.437, 24.7536],
  ["Riga", "LV", 56.9496, 24.1052],
  ["Vilnius", "LT", 54.6872, 25.2797],
  ["Reykjavik", "IS", 64.1466, -21.9426, ["reykjavík"]],
  ["Madrid", "ES", 40.4168, -3.7038],
  ["Barcelona", "ES", 41.3874, 2.1686],
  ["Valencia", "ES", 39.4699, -0.3763],
  ["Lisbon", "PT", 38.7223, -9.1393, ["lisboa"]],
  ["Porto", "PT", 41.1579, -8.6291],
  ["Milan", "IT", 45.4642, 9.19, ["milano"]],
  ["Rome", "IT", 41.9028, 12.4964, ["roma"]],
  ["Turin", "IT", 45.0703, 7.6869, ["torino"]],
  // Middle East and Africa
  ["Tel Aviv", "IL", 32.0853, 34.7818, ["tel aviv-yafo", "herzliya", "ramat gan"]],
  ["Jerusalem", "IL", 31.7683, 35.2137],
  ["Dubai", "AE", 25.2048, 55.2708],
  ["Abu Dhabi", "AE", 24.4539, 54.3773],
  ["Riyadh", "SA", 24.7136, 46.6753],
  ["Doha", "QA", 25.2854, 51.531],
  ["Cairo", "EG", 30.0444, 31.2357],
  ["Casablanca", "MA", 33.5731, -7.5898],
  ["Lagos", "NG", 6.5244, 3.3792],
  ["Accra", "GH", 5.6037, -0.187],
  ["Nairobi", "KE", -1.2921, 36.8219],
  ["Kigali", "RW", -1.9441, 30.0619],
  ["Cape Town", "ZA", -33.9249, 18.4241],
  ["Johannesburg", "ZA", -26.2041, 28.0473, ["sandton"]],
  // Asia
  ["Singapore", "SG", 1.3521, 103.8198],
  ["Hong Kong", "HK", 22.3193, 114.1694],
  ["Tokyo", "JP", 35.6762, 139.6503],
  ["Osaka", "JP", 34.6937, 135.5023],
  ["Seoul", "KR", 37.5665, 126.978],
  ["Beijing", "CN", 39.9042, 116.4074],
  ["Shanghai", "CN", 31.2304, 121.4737],
  ["Shenzhen", "CN", 22.5431, 114.0579],
  ["Hangzhou", "CN", 30.2741, 120.1551],
  ["Taipei", "TW", 25.033, 121.5654],
  ["Bangalore", "IN", 12.9716, 77.5946, ["bengaluru"]],
  ["Mumbai", "IN", 19.076, 72.8777, ["bombay"]],
  ["Delhi", "IN", 28.7041, 77.1025, ["new delhi", "ncr"]],
  ["Gurgaon", "IN", 28.4595, 77.0266, ["gurugram"]],
  ["Noida", "IN", 28.5355, 77.391],
  ["Hyderabad", "IN", 17.385, 78.4867],
  ["Chennai", "IN", 13.0827, 80.2707],
  ["Pune", "IN", 18.5204, 73.8567],
  ["Kolkata", "IN", 22.5726, 88.3639],
  ["Jakarta", "ID", -6.2088, 106.8456],
  ["Kuala Lumpur", "MY", 3.139, 101.6869],
  ["Bangkok", "TH", 13.7563, 100.5018],
  ["Ho Chi Minh City", "VN", 10.8231, 106.6297, ["saigon"]],
  ["Hanoi", "VN", 21.0278, 105.8342],
  ["Manila", "PH", 14.5995, 120.9842, ["makati", "bgc", "taguig"]],
  ["Dhaka", "BD", 23.8103, 90.4125],
  ["Karachi", "PK", 24.8607, 67.0011],
  ["Lahore", "PK", 31.5204, 74.3587],
  ["Islamabad", "PK", 33.6844, 73.0479],
  // Oceania
  ["Sydney", "AU", -33.8688, 151.2093],
  ["Melbourne", "AU", -37.8136, 144.9631],
  ["Brisbane", "AU", -27.4698, 153.0251],
  ["Perth", "AU", -31.9505, 115.8605],
  ["Adelaide", "AU", -34.9285, 138.6007],
  ["Canberra", "AU", -35.2809, 149.13],
  ["Auckland", "NZ", -36.8485, 174.7633],
  ["Wellington", "NZ", -41.2865, 174.7762],
];

interface Entry extends Place {
  keys: string[];
}

const ENTRIES: Entry[] = ROWS.map(([name, country, lat, lng, aliases = [], region]) => ({
  name,
  country,
  region,
  lat,
  lng,
  keys: [name.toLowerCase(), ...aliases],
}));

/** Text that says which of two same-name cities is meant. */
const REGION_HINTS: Record<string, RegExp> = {
  US: /\b(us|usa|u\.s\.a?\.?|united states|america)\b/,
  GB: /\b(uk|u\.k\.|united kingdom|england|scotland|britain|gb)\b/,
  CA: /\b(canada|ontario|on)\b/,
};
const STATE_NAMES: Record<string, string> = {
  CA: "california",
  MA: "massachusetts",
  OR: "oregon",
  ME: "maine",
  AL: "alabama",
  VA: "virginia",
  NY: "new york",
  WA: "washington",
  ON: "ontario",
  England: "england",
};

function pick(candidates: Entry[], text: string): Entry {
  if (candidates.length === 1) return candidates[0];
  for (const c of candidates) {
    const state = c.region ? new RegExp(`(^|[^a-z])(${c.region.toLowerCase()}|${STATE_NAMES[c.region] ?? "\\u0000"})([^a-z]|$)`).test(text) : false;
    if (state) return c;
  }
  for (const c of candidates) if (REGION_HINTS[c.country]?.test(text)) return c;
  return candidates[0];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEY_INDEX = ENTRIES.flatMap((e) => e.keys.map((k) => ({ k, e }))).sort((a, b) => b.k.length - a.k.length);

/**
 * "Greater New York City Area" → New York. "Cambridge, MA" → Cambridge, US. "Remote" → null.
 * Matches the first comma-separated part exactly when it can, else the longest known name anywhere.
 */
export function resolvePlace(raw: string | null | undefined): ResolvedPlace | null {
  if (!raw) return null;
  const text = raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(greater|metropolitan|metro)\b/g, " ")
    .replace(/\b(area|region)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^(remote|virtual|anywhere|online|worldwide|global|n\/a)\b/.test(text)) return null;
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const head = parts[0] ?? "";
  // DC is written with its comma ("Washington, DC"): try the whole text before splitting it.
  const whole = ENTRIES.filter((e) => e.keys.includes(text));
  if (whole.length) return { ...strip(pick(whole, text)), precision: "city" };
  const exact = ENTRIES.filter((e) => e.keys.includes(head));
  if (exact.length) return { ...strip(pick(exact, text)), precision: "city" };
  // "San Francisco Bay" or "Downtown Austin": a known name inside the first part.
  for (const { k } of KEY_INDEX) {
    // Two-letter keys ("la", "dc", "sf") only count on their own, never inside a word.
    if (new RegExp(`(^|[^a-z])${escape(k)}([^a-z]|$)`).test(head)) {
      return { ...strip(pick(ENTRIES.filter((e) => e.keys.includes(k)), text)), precision: "city" };
    }
  }
  // "SoMa, San Francisco": a later part that is a city, never a state or country ("Albany, New York").
  for (const part of parts.slice(1)) {
    if (REGIONS.has(part)) continue;
    const later = ENTRIES.filter((e) => e.keys.includes(part));
    if (later.length) return { ...strip(pick(later, text)), precision: "city" };
  }
  return null;
}

/** States, provinces and countries: a later comma part that is one of these says where, not which city. */
const REGIONS = new Set(
  (
    "alabama,alaska,arizona,arkansas,california,colorado,connecticut,delaware,florida,georgia,hawaii,idaho,illinois,indiana,iowa,kansas,kentucky,louisiana,maine,maryland,massachusetts,michigan,minnesota,mississippi,missouri,montana,nebraska,nevada,new hampshire,new jersey,new mexico,new york,north carolina,north dakota,ohio,oklahoma,oregon,pennsylvania,rhode island,south carolina,south dakota,tennessee,texas,utah,vermont,virginia,washington,west virginia,wisconsin,wyoming," +
    "ontario,quebec,british columbia,alberta,manitoba,saskatchewan,nova scotia,england,scotland,wales,northern ireland," +
    "united states,usa,us,united kingdom,uk,canada,germany,france,spain,italy,netherlands,india,china,japan,australia,singapore,israel,brazil,mexico,ireland,sweden,switzerland"
  ).split(","),
);

function strip(e: Entry): Place {
  return { name: e.name, country: e.country, region: e.region, lat: e.lat, lng: e.lng };
}

/** Cities whose name starts with the query, for the location picker's instant suggestions. */
export function searchPlaces(q: string, limit = 5): Place[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const seen = new Set<string>();
  return ENTRIES.filter((e) => e.keys.some((k) => k.startsWith(s)))
    .filter((e) => {
      const key = `${e.name}|${e.country}|${e.region ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(strip);
}

/** "San Francisco, CA" / "London, GB": the label a person reads and Apollo's location filter takes. */
export function placeLabel(p: Pick<Place, "name" | "country" | "region">): string {
  if (p.region && p.name.endsWith(p.region)) return p.name;
  return p.country === "US" || p.country === "CA" ? `${p.name}, ${p.region ?? p.country}` : `${p.name}, ${p.country}`;
}

/* ───────────── Geometry ───────────── */

const R = 6371.0088; // mean Earth radius, km

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A closed ring of [lng, lat] points `radiusKm` around a center, for the map's radius fill. */
export function circleRing(center: { lat: number; lng: number }, radiusKm: number, steps = 96): [number, number][] {
  const ring: [number, number][] = [];
  const lat = (center.lat * Math.PI) / 180;
  const lng = (center.lng * Math.PI) / 180;
  const d = radiusKm / R;
  for (let i = 0; i <= steps; i++) {
    const brg = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(brg));
    const lng2 = lng + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2));
    ring.push([(((lng2 * 180) / Math.PI + 540) % 360) - 180, (lat2 * 180) / Math.PI]);
  }
  return ring;
}

/**
 * City-level pins all sit on the city center. Spread them a little (deterministically, by id) so a
 * zoomed-in map shows each one, without pretending to know a street address.
 */
export function spread(id: string, at: { lat: number; lng: number }, maxKm = 3): { lat: number; lng: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 3600) / 3600;
  const r = (((h >>> 12) % 1000) / 1000) ** 0.5 * maxKm;
  const dLat = (r / 111.32) * Math.cos(a * 2 * Math.PI);
  const dLng = (r / (111.32 * Math.cos((at.lat * Math.PI) / 180))) * Math.sin(a * 2 * Math.PI);
  return { lat: at.lat + dLat, lng: at.lng + dLng };
}

/** Miles in the US (and UK), kilometres elsewhere: the unit a founder reads a radius in. */
export function usesMiles(locale = typeof navigator === "undefined" ? "en-US" : navigator.language): boolean {
  return /^en-(US|GB|LR|MM)$/i.test(locale) || locale === "en";
}

export const KM_PER_MI = 1.609344;

export function formatDistance(km: number, miles: boolean): string {
  const v = miles ? km / KM_PER_MI : km;
  const unit = miles ? "mi" : "km";
  const tenth = Math.round(v * 10) / 10;
  return tenth < 1 ? `<1 ${unit}` : tenth < 10 ? `${tenth.toFixed(1)} ${unit}` : `${Math.round(v)} ${unit}`;
}
