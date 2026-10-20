import type { Connection, Workspace } from "@/lib/domain/types";
import type { Clock } from "./clock";
import { DOMAIN } from "./ids";

type Fit = NonNullable<Connection["screen"]>["icpCompany"];
/** first, last, company, position, connected (days ago), ICP fit, buyer title, matched domain, previous job */
type Row = [string, string, string, string, number, Fit, boolean, string?, [string, string]?];

/** The founder's LinkedIn connections as the network screen left them: ex-Tollgate, investors, peers, prospects. */
const ROWS: Row[] = [
  // Job changes found on the latest re-import
  ["Lena", "Fischer", "Glassmoor", "Head of Billing Operations", 1460, "yes", true, DOMAIN.glassmoor, ["Tollgate", "Billing Infrastructure Lead"]],
  ["Theo", "Grant", "Hollowpine", "Finance Lead", 70, "yes", true, DOMAIN.hollowpine, ["Wrenfield", "Senior Revenue Accountant"]],
  // People at companies already in the workspace
  ["Ava", "Whitman", "Wrenfield", "Controller", 900, "yes", true, DOMAIN.wrenfield],
  ["Dana", "Okafor", "Northwind Metrics", "Controller", 13, "yes", true, DOMAIN.northwind],
  ["Ethan", "Brooks", "Lumenwire", "Head of Revenue Accounting", 50, "yes", true, DOMAIN.lumenwire],
  ["Tom", "Becker", "Rowanstack", "Director of Billing Operations", 120, "yes", true, DOMAIN.rowanstack],
  ["Priyanka", "Shah", "Driftglass", "Senior Product Manager", 610, "yes", false, DOMAIN.driftglass],
  ["Marco", "Bellini", "Cinderpath", "Staff Engineer", 1020, "yes", false, DOMAIN.cinderpath],
  ["Hannah", "Cole", "Ashgrove Telematics", "Senior Data Engineer", 480, "yes", false, DOMAIN.ashgrove],
  // Investors, angels, advisors
  ["Claire", "Donovan", "Alder Street Ventures", "Partner", 400, "no", false],
  ["Rohan", "Mehta", "Independent", "Angel investor, former CFO", 720, "no", false],
  ["Ines", "Duarte", "Independent", "Advisor to finance teams", 300, "no", false],
  ["Felix", "Navarro", "Alder Street Ventures", "Head of Platform", 380, "no", false],
  // Former Tollgate colleagues
  ["Samir", "Khan", "Tollgate", "Engineering Manager, Billing", 1800, "no", false],
  ["Julia", "Brandt", "Tollgate", "Staff Engineer, Metering", 1750, "no", false],
  ["Noah", "Fitzgerald", "Tollgate", "Product Manager, Invoicing", 1600, "no", false],
  ["Grace", "Okonkwo", "Tollgate", "Revenue Accounting Manager", 1500, "no", true],
  ["Daniel", "Weiss", "Tollgate", "Senior Software Engineer", 1700, "no", false],
  ["Aisha", "Rahman", "Tollgate", "Director of Finance Systems", 1400, "no", true],
  ["Kenji", "Watanabe", "Tollgate", "Data Engineer", 1300, "no", false],
  // Peers at other companies, screened
  ["Olivia", "Hart", "Pebblework", "Controller", 640, "maybe", true],
  ["Lucas", "Moreau", "Stackfern", "VP Finance", 520, "maybe", true],
  ["Zara", "Ibrahim", "Kitewell Analytics", "Head of Revenue Operations", 330, "yes", true],
  ["Ben", "Ashworth", "Tesserine Cloud", "CFO", 820, "yes", true],
  ["Mila", "Novak", "Brightfold", "Senior Accountant", 260, "maybe", false],
  ["Ryan", "Cho", "Ironvale", "Controller", 410, "no", true],
  ["Emma", "Lindgren", "Harborwick Health", "Finance Manager", 900, "no", true],
  ["Omar", "Farouk", "Quarrystone", "Founder & CEO", 1100, "maybe", true],
  ["Sophie", "Turner", "Lanternfish", "Head of Data", 560, "maybe", false],
  ["Mateo", "Ruiz", "Fieldmoss", "Engineering Manager", 470, "no", false],
  ["Chloe", "Dubois", "Pinemark Studio", "Designer", 980, "no", false],
  ["Ethan", "Park", "Copperline", "Account Executive", 210, "no", false],
  ["Isabel", "Ferreira", "Ridgewick Payments", "Payments Operations Lead", 1250, "no", false],
  ["Liam", "O'Connor", "Northfold Capital", "Associate", 150, "no", false],
  ["Nina", "Petrova", "Moonbeam API", "Director of Finance", 190, "yes", true],
  ["Arjun", "Iyer", "Sablewood", "Software Engineer", 1150, "no", false],
  ["Grace", "Kim", "Latchpoint", "Revenue Accountant", 380, "maybe", false],
  ["Hugo", "Laurent", "Velvet Index", "CTO", 700, "maybe", false],
  ["Rachel", "Adams", "Clearwick Data", "Controller", 95, "yes", true],
  ["Tariq", "Hassan", "Bluefen Compute", "VP Engineering", 260, "maybe", false],
];

const normalize = (company: string) =>
  company
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(inc|llc|ltd|labs|corp)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function connections(c: Clock): Connection[] {
  const screenedAt = c.at(-5, "18:31");
  return ROWS.map(([firstName, lastName, company, position, daysAgo, icpCompany, buyerTitle, matchedDomain, previous], i) => ({
    id: `con_${String(i + 1).padStart(3, "0")}`,
    firstName,
    lastName,
    url: `https://linkedin.example/in/${`${firstName}-${lastName}`.toLowerCase().replace(/[^a-z-]/g, "")}`,
    company,
    position,
    connectedOn: c.d(-daysAgo),
    companyNorm: normalize(company),
    ...(matchedDomain ? { matchedDomain } : {}),
    screen: { icpCompany, buyerTitle, screenedAt },
    ...(previous ? { previous: { company: previous[0], position: previous[1], changedOn: c.d(-5) } } : {}),
  }));
}

/** The workspace's network summary, computed from the same rows so the two always agree. */
export function networkSummary(c: Clock, rows: Connection[]): NonNullable<Workspace["network"]> {
  return {
    importedAt: c.at(-5, "18:31"),
    total: rows.length,
    atIcpCompanies: rows.filter((r) => r.screen?.icpCompany === "yes").length,
    buyerTitles: rows.filter((r) => r.screen?.icpCompany === "yes" && r.screen.buyerTitle).length,
    jobChanges: rows.filter((r) => r.previous).length,
  };
}
