import { allocate } from "../services/money";
import { InvoiceStatus } from "../types";

/**
 * Deterministic demo catalog. No Math.random — the same ledger is seeded every boot.
 * FX is the illustrative rate stored on historical invoices (USD 129, EUR 140.5, GBP 168.2).
 */

export const FX_RATES: Record<string, number> = {
  USD: 129,
  EUR: 140.5,
  GBP: 168.2,
};

export const MPESA_BANK_CODE = "SAFKEN";

export const BANKS = [
  { name: "KCB", code: "01" },
  { name: "Equity Bank", code: "68" },
  { name: "Co-operative Bank", code: "11" },
  { name: "NCBA", code: "07" },
] as const;

export function fxFor(currency: string): number {
  return FX_RATES[currency.toUpperCase()] ?? FX_RATES.USD;
}

/** Integer percentage shares that sum to exactly 100, weighted by kilos. */
export function integerShares(kilos: number[]): number[] {
  if (kilos.length === 0) throw new Error("Cannot allocate shares across zero farmers");
  const rows = allocate(
    100,
    kilos.map((k) => ({ share: k }))
  );
  const shares = rows.map((row) => row.amt);
  let guard = 0;
  while (shares.some((share) => share <= 0)) {
    if (guard++ > shares.length) throw new Error("Could not give every farmer a positive share");
    const zeroAt = shares.findIndex((share) => share <= 0);
    let donor = 0;
    for (let i = 1; i < shares.length; i++) {
      if (shares[i] > shares[donor]) donor = i;
    }
    if (shares[donor] <= 1) throw new Error("Not enough share points for every farmer");
    shares[donor] -= 1;
    shares[zeroAt] = 1;
  }
  const sum = shares.reduce((total, share) => total + share, 0);
  if (sum !== 100) throw new Error(`Contribution shares sum to ${sum}, expected 100`);
  return shares;
}

export type InvoiceBlueprint = {
  id: string;
  reference: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  amount: number;
  currency: "USD" | "EUR" | "GBP";
  description: string;
  status: InvoiceStatus;
  createdDaysAgo: number;
  dueDaysFromNow: number;
  checkoutRef: string | null;
};

export type FarmerSpec = {
  name: string;
  kilos: number;
  unverifiedMpesa?: boolean;
  phone?: string;
  id_number?: string;
  share?: number;
};

export type CoopCatalog = {
  id: string;
  slug: string;
  name: string;
  phoneStem: string;
  idStem: number;
  treasurer: { id: string; full_name: string; phone: string; id_number: string };
  farmers: FarmerSpec[];
  invoices: InvoiceBlueprint[];
};

export type ExporterCatalog = {
  id: string;
  full_name: string;
  business: string;
  phone: string;
  id_number: string;
  town: string;
  invoices: InvoiceBlueprint[];
};

type Buyer = { name: string; email: string; phone: string; city: string };

function buyer(name: string, email: string, phone: string, city: string): Buyer {
  return { name, email, phone, city };
}

function dueFromNow(createdDaysAgo: number, status: InvoiceStatus): number {
  if (status === "pending") return 21;
  if (status === "paid") return 12;
  if (status === "converting") return 8;
  if (status === "settling") return 5;
  if (status === "failed") return -Math.max(createdDaysAgo - 7, 1);
  return -Math.max(createdDaysAgo - 14, 1);
}

function buildInvoices(opts: {
  idPrefix: string;
  refPrefix: string;
  buyers: Buyer[];
  commodity: string;
  origin: string;
  grades: string[];
  statuses: InvoiceStatus[];
  daysAgo: number[];
  amounts: number[];
  currencies: Array<"USD" | "EUR" | "GBP">;
  kgDivisor: number;
}): InvoiceBlueprint[] {
  const n = opts.statuses.length;
  const lens = [opts.buyers.length, opts.daysAgo.length, opts.amounts.length, opts.currencies.length];
  if (lens.some((len) => len !== n)) {
    throw new Error(`${opts.idPrefix}: expected ${n} invoice rows, got ${lens.join(",")}`);
  }
  return opts.statuses.map((status, i) => {
    const party = opts.buyers[i];
    const amount = opts.amounts[i];
    const grade = opts.grades[i % opts.grades.length];
    const kg = Math.max(80, Math.round(amount / opts.kgDivisor));
    const reference = `${opts.refPrefix}-${String(i + 1).padStart(3, "0")}`;
    const open = status === "pending" || status === "failed";
    return {
      id: `${opts.idPrefix}_${String(i + 1).padStart(2, "0")}`,
      reference,
      buyer_name: party.name,
      buyer_email: party.email,
      buyer_phone: party.phone,
      amount,
      currency: opts.currencies[i],
      description: `Ref ${reference}: ${kg} kg ${grade} ${opts.commodity} · FOB ${opts.origin} · ${party.city}`,
      status,
      createdDaysAgo: opts.daysAgo[i],
      dueDaysFromNow: dueFromNow(opts.daysAgo[i], status),
      checkoutRef: open ? null : `PZ-CHK-${reference}`,
    };
  });
}

function withKilos(salt: number, people: Array<string | { name: string; unverifiedMpesa: true }>): FarmerSpec[] {
  return people.map((entry, i) => {
    const name = typeof entry === "string" ? entry : entry.name;
    return {
      name,
      kilos: 220 + ((i * 47 + salt) % 780),
      unverifiedMpesa: typeof entry === "string" ? undefined : true,
    };
  });
}

export const CANONICAL = {
  coopId: "coop_kiambu",
  coopName: "Kiambu Highlands Coffee Co-op",
  treasurerId: "acc_treasurer",
  exporterId: "acc_exporter",
  invoices: {
    paid_coop: "inv_coop_hamburg_101",
    awaiting_split_coop: "inv_coop_berlin_102",
    pending_coop: "inv_coop_rotterdam_103",
    paid_direct: "inv_direct_ny_201",
    pending_direct: "inv_2413",
  },
} as const;

export const KIAMBU_FARMERS: FarmerSpec[] = [
  { name: "Wanjiku Mwangi", phone: "+254712000001", id_number: "ID2000001", share: 15, kilos: 1500 },
  { name: "Juma Omondi", phone: "+254712000002", id_number: "ID2000002", share: 12, kilos: 1200 },
  { name: "Fatuma Ali", phone: "+254712000003", id_number: "ID2000003", share: 10, kilos: 1000 },
  { name: "Kipchoge Cheruiyot", phone: "+254712000004", id_number: "ID2000004", share: 10, kilos: 1000 },
  { name: "Achieng Otieno", phone: "+254712000005", id_number: "ID2000005", share: 10, kilos: 1000 },
  { name: "Maina Njoroge", phone: "+254712000006", id_number: "ID2000006", share: 9, kilos: 900 },
  { name: "Halima Hassan", phone: "+254712000007", id_number: "ID2000007", share: 9, kilos: 900 },
  { name: "Mutua Musyoka", phone: "+254712000008", id_number: "ID2000008", share: 9, kilos: 900 },
  { name: "Nyaboke Kerubo", phone: "+254712000009", id_number: "ID2000009", share: 8, kilos: 800 },
  { name: "Kibet Rotich", phone: "+254712000010", id_number: "ID2000010", share: 8, kilos: 800 },
];

export const CANONICAL_INVOICES: Array<InvoiceBlueprint & { type: "coop" | "direct" }> = [
  {
    id: CANONICAL.invoices.paid_coop,
    type: "coop",
    reference: "INV-COOP-HAMBURG-101",
    buyer_name: "Hanseatic Coffee Roasters GmbH",
    buyer_email: "payments@hanseatic-coffee.de",
    buyer_phone: "+494012345678",
    amount: 12400,
    currency: "USD",
    description: "Container Lot AA Premium Arabica - Hamburg",
    status: "completed",
    createdDaysAgo: 7,
    dueDaysFromNow: -5,
    checkoutRef: "PZ-CHK-HAMBURG-001",
  },
  {
    id: CANONICAL.invoices.awaiting_split_coop,
    type: "coop",
    reference: "INV-COOP-BERLIN-102",
    buyer_name: "The Barn Berlin",
    buyer_email: "orders@thebarn.de",
    buyer_phone: "+493012345678",
    amount: 8500,
    currency: "USD",
    description: "Specialty Peaberry Micro-Lot - Berlin",
    status: "settling",
    createdDaysAgo: 2,
    dueDaysFromNow: 3,
    checkoutRef: "PZ-CHK-BERLIN-002",
  },
  {
    id: CANONICAL.invoices.pending_coop,
    type: "coop",
    reference: "INV-COOP-ROTTERDAM-103",
    buyer_name: "Rotterdam Commodity Traders B.V.",
    buyer_email: "procurement@rctraders.nl",
    buyer_phone: "+31101234567",
    amount: 15000,
    currency: "USD",
    description: "Fairtrade Grade 1 Green Coffee - Rotterdam",
    status: "pending",
    createdDaysAgo: 1,
    dueDaysFromNow: 10,
    checkoutRef: null,
  },
  {
    id: CANONICAL.invoices.paid_direct,
    type: "direct",
    reference: "INV-EXP-NY-201",
    buyer_name: "Brooklyn Artisan Goods",
    buyer_email: "orders@brooklynartisan.com",
    buyer_phone: "+12125550192",
    amount: 3200,
    currency: "USD",
    description: "Handwoven Sisal & Banana Bark Baskets - New York",
    status: "completed",
    createdDaysAgo: 4,
    dueDaysFromNow: -2,
    checkoutRef: "PZ-CHK-NY-004",
  },
  {
    id: CANONICAL.invoices.pending_direct,
    type: "direct",
    reference: "INV-EXP-LONDON-202",
    buyer_name: "Covent Garden Fair Trade Ltd",
    buyer_email: "finance@coventfairtrade.co.uk",
    buyer_phone: "+442079460912",
    amount: 1800,
    currency: "EUR",
    description: "Beaded Maasai Leather Accessories - London",
    status: "pending",
    createdDaysAgo: 0,
    dueDaysFromNow: 14,
    checkoutRef: null,
  },
];

const COFFEE_BUYERS: Buyer[] = [
  buyer("Square Mile Coffee Roasters", "accounts@squaremilecoffee.com", "+442073328800", "London"),
  buyer("The Coffee Collective", "ap@coffeecollective.dk", "+4532124400", "Copenhagen"),
  buyer("Drop Coffee Roasters", "finance@dropcoffee.com", "+468123450", "Stockholm"),
  buyer("Tim Wendelboe", "orders@timwendelboe.no", "+4722001100", "Oslo"),
  buyer("Stumptown Coffee Roasters", "payables@stumptowncoffee.com", "+15034780000", "Portland"),
  buyer("Blue Bottle Coffee", "vendors@bluebottlecoffee.com", "+15106530000", "Oakland"),
  buyer("Workshop Coffee", "accounts@workshopcoffee.com", "+442072580100", "London"),
];

const TEA_BUYERS: Buyer[] = [
  buyer("Ahmad Tea London", "accounts@ahmadtea.com", "+442088050500", "London"),
  buyer("Bettys & Taylors of Harrogate", "procurement@bettys.co.uk", "+441423814000", "Harrogate"),
  buyer("Mariage Frères", "export@mariagefreres.com", "+33143431850", "Paris"),
  buyer("Palais des Thés", "fournisseurs@palaisdesthes.com", "+33146334040", "Paris"),
  buyer("Ronnefeldt Tee", "einkauf@ronnefeldt.com", "+4961032970", "Frankfurt"),
  buyer("TeeGschwendner", "import@teegschwendner.de", "+49221937070", "Cologne"),
  buyer("Newby Teas", "accounts@newbyteas.com", "+442078390000", "London"),
  buyer("Jing Tea", "finance@jingtea.com", "+442089470000", "London"),
  buyer("Kusmi Tea", "achats@kusmitea.com", "+33153400010", "Paris"),
  buyer("Fortnum & Mason", "buying@fortnumandmason.com", "+442077348040", "London"),
  buyer("Lupicia", "trade@lupicia.com", "+81354568000", "Tokyo"),
];

const NUT_BUYERS: Buyer[] = [
  buyer("Seeberger GmbH", "einkauf@seeberger.de", "+4973194900", "Ulm"),
  buyer("Farmer's Snack GmbH", "buying@farmers-snack.de", "+4941066090", "Seevetal"),
  buyer("Rapunzel Naturkost", "einkauf@rapunzel.de", "+4983318700", "Legau"),
  buyer("Davert GmbH", "purchase@davert.de", "+4925929100", "Ascheberg"),
  buyer("Borges International", "imports@borges.es", "+34977309000", "Reus"),
  buyer("Olam Food Ingredients", "eu.payments@ofi.com", "+31108080000", "Rotterdam"),
  buyer("Clasen Bio", "orders@clasen-bio.de", "+4969793000", "Frankfurt"),
  buyer("Alnatura Produktions", "lieferanten@alnatura.de", "+49625793200", "Bickenbach"),
  buyer("Govinda Natur", "einkauf@govinda-natur.de", "+492219460000", "Cologne"),
  buyer("Hamlet", "procurement@hamlet.be", "+3250445000", "Bruges"),
  buyer("Nutwork Handelsgesellschaft", "ap@nutwork.de", "+4940300000", "Hamburg"),
];

const FLOWER_BUYERS: Buyer[] = [
  buyer("Dutch Flower Group", "finance@dutchflowergroup.com", "+31297380000", "Aalsmeer"),
  buyer("FleuraMetz", "creditors@fleurametz.com", "+31297382000", "Aalsmeer"),
  buyer("Waterdrinker Aalsmeer", "inkoop@waterdrinker.nl", "+31297383000", "Aalsmeer"),
  buyer("Barendsen", "purchase@barendsen.nl", "+31297384000", "Aalsmeer"),
  buyer("Dutch Grown", "accounts@dutchgrown.com", "+31297385000", "Aalsmeer"),
  buyer("Bloom & Wild", "suppliers@bloomandwild.com", "+442039000100", "London"),
  buyer("Interflora France", "achats@interflora.fr", "+33145000010", "Paris"),
  buyer("OZexport", "finance@ozexport.nl", "+31297386000", "Aalsmeer"),
  buyer("FM Group Flowers", "ap@fmgroup.nl", "+31297387000", "Aalsmeer"),
  buyer("Margin Buyers Desk", "desk@floraholland-buyers.nl", "+31297388000", "Aalsmeer"),
];

const CRAFT_BUYERS: Buyer[] = [
  buyer("Ten Thousand Villages", "vendors@tenthousandvillages.com", "+17175758000", "Akron"),
  buyer("The Citizenry", "accounts@the-citizenry.com", "+12145550110", "Dallas"),
  buyer("Okapi Studio", "orders@okapistudio.com", "+442070001100", "London"),
  buyer("Servv Craft House", "finance@servv.com", "+14155550120", "San Francisco"),
];

const HONEY_BUYERS: Buyer[] = [
  buyer("Rowse Honey", "suppliers@rowsehoney.co.uk", "+441491827400", "Wallingford"),
  buyer("Allos Hof-Manufaktur", "einkauf@allos.de", "+4942616600", "Bremen"),
  buyer("Rigoni di Asiago", "acquisti@rigonidiasiago.com", "+390424560000", "Asiago"),
  buyer("Biophar", "achats@biophar.be", "+3284500010", "Ghislenghien"),
  buyer("Comvita Europe", "trade@comvita.eu", "+442070002200", "London"),
  buyer("D'arbo", "einkauf@darbo.at", "+4352426930", "Stans"),
];

const LEATHER_BUYERS: Buyer[] = [
  buyer("Atelier Heschung", "fournisseurs@heschung.com", "+33388220000", "Strasbourg"),
  buyer("Il Bisonte", "acquisti@ilbisonte.com", "+390552100000", "Florence"),
  buyer("Sandqvist", "suppliers@sandqvist.com", "+4680001100", "Stockholm"),
  buyer("Berluti", "achats@berluti.com", "+33144310000", "Paris"),
  buyer("Velorbis", "orders@velorbis.com", "+4533001100", "Copenhagen"),
  buyer("ECCO Leather", "materials@ecco.com", "+3140001100", "Dongen"),
];

const AVOCADO_BUYERS: Buyer[] = [
  buyer("Nature's Pride", "finance@naturespride.eu", "+31174530000", "Maasdijk"),
  buyer("Westfalia Fruit Europe", "accounts@westfaliafruit.com", "+31108090000", "Rotterdam"),
  buyer("Trops", "compras@trops.es", "+34952480000", "Vélez-Málaga"),
  buyer("Halls Europe", "procurement@halls.co.za", "+441793551000", "Swindon"),
  buyer("Dole Europe Fresh", "vendors@dole.com", "+31102000010", "Rotterdam"),
  buyer("Eurofresh", "ap@eurofresh.nl", "+31107000110", "Rotterdam"),
];

const SISAL_BUYERS: Buyer[] = [
  buyer("Seaman Paper", "purchasing@seamanpaper.com", "+15088650000", "Gardner"),
  buyer("Yorkshire Natural Fibre", "accounts@ynf.co.uk", "+441274000110", "Bradford"),
  buyer("Taparo", "achizitii@taparo.ro", "+40262000110", "Targu Lapus"),
  buyer("EcoFiber Bremen", "einkauf@ecofiber.de", "+49421000110", "Bremen"),
  buyer("Bouwmeester Fibres", "finance@bouwmeester.nl", "+31102000120", "Rotterdam"),
  buyer("International Cordage", "accounts@intlcordage.co.uk", "+441612000110", "Manchester"),
];

const SPICE_BUYERS: Buyer[] = [
  buyer("Nedspice", "accounts@nedspice.com", "+31104000010", "Rotterdam"),
  buyer("Verstegen Spices", "crediteuren@verstegen.nl", "+31104280000", "Rotterdam"),
  buyer("Fuchs Gruppe", "einkauf@fuchs.de", "+4954213090", "Dissen"),
  buyer("British Pepper & Spice", "accounts@britishpepper.co.uk", "+441604000110", "Northampton"),
  buyer("Ostmann Gewürze", "einkauf@ostmann.de", "+4954213000", "Dissen"),
  buyer("Schwartz", "suppliers@schwartz.co.uk", "+441844000110", "Haddenham"),
];

export const KIAMBU_EXTRA_INVOICES: InvoiceBlueprint[] = buildInvoices({
  idPrefix: "inv_khm",
  refPrefix: "KHM",
  buyers: COFFEE_BUYERS,
  commodity: "washed Arabica green coffee",
  origin: "Mombasa",
  grades: ["AA", "AB", "PB peaberry", "Ruiru 11"],
  statuses: ["completed", "completed", "completed", "completed", "failed", "paid", "converting"],
  daysAgo: [240, 180, 120, 60, 40, 20, 12],
  amounts: [18640, 9200, 14350, 6100, 4800, 7750, 11200],
  currencies: ["USD", "EUR", "USD", "GBP", "USD", "EUR", "USD"],
  kgDivisor: 5.4,
});

const HISTORY_11: InvoiceStatus[] = [
  "completed",
  "completed",
  "completed",
  "completed",
  "completed",
  "completed",
  "failed",
  "paid",
  "converting",
  "settling",
  "pending",
];

const DAYS_11 = [260, 230, 200, 170, 140, 110, 75, 30, 14, 6, 1];

const CURRENCY_11: Array<"USD" | "EUR" | "GBP"> = [
  "USD",
  "EUR",
  "USD",
  "GBP",
  "USD",
  "EUR",
  "USD",
  "GBP",
  "EUR",
  "USD",
  "GBP",
];

export const EXTRA_COOPS: CoopCatalog[] = [
  {
    id: "coop_kericho",
    slug: "kericho",
    name: "Kericho Gold Tea Growers",
    phoneStem: "713",
    idStem: 41300000,
    treasurer: {
      id: "acc_treasurer_kericho",
      full_name: "Chebet Langat",
      phone: "+254713000000",
      id_number: "41300000",
    },
    farmers: withKilos(11, [
      "Cherotich Chebet",
      "Kiprono Langat",
      "Jepkemboi Ruto",
      "Kiplagat Bett",
      "Chepngetich Sigei",
      "Kiptoo Arap Sang",
      "Jeruto Chepkwony",
      { name: "Kipkemoi Kosgei", unverifiedMpesa: true },
      "Chepkoech Tanui",
      "Kipruto Ngeno",
      "Jepchirchir Soi",
      "Kibet Kirui",
      "Chelimo Maritim",
      "Kipngeno Mutai",
      "Jebet Korir",
      "Kipsang Towett",
      "Chepkemoi Rono",
      "Kipchumba Keter",
      "Jerop Cheruiyot",
      "Kiptanui Boit",
      "Chebet Koech",
      "Kiprop Lagat",
      "Jepngetich Yego",
      "Kimutai Busienei",
      "Chepkurui Serem",
      "Kipleting Maiyo",
      "Jesang Too",
      "Kipkoech Barmao",
    ]),
    invoices: buildInvoices({
      idPrefix: "inv_krc",
      refPrefix: "KRC",
      buyers: TEA_BUYERS,
      commodity: "CTC black tea",
      origin: "Mombasa",
      grades: ["BP1", "PF1", "PD", "Dust 1"],
      statuses: HISTORY_11,
      daysAgo: DAYS_11,
      amounts: [22150, 16800, 9400, 27500, 13220, 18750, 5600, 14900, 8300, 19640, 7100],
      currencies: CURRENCY_11,
      kgDivisor: 3.2,
    }),
  },
  {
    id: "coop_meru",
    slug: "meru",
    name: "Meru Macadamia Union",
    phoneStem: "714",
    idStem: 41400000,
    treasurer: {
      id: "acc_treasurer_meru",
      full_name: "Muriuki Mwenda",
      phone: "+254714000000",
      id_number: "41400000",
    },
    farmers: withKilos(29, [
      "Muriithi M'Mbui",
      "Karambu Mwiti",
      "Gitonga M'Ikiara",
      "Kananu M'Rintari",
      "Mutuma Kirimi",
      "Gakii Muthomi",
      "Mwirigi M'Nkanata",
      "Kawira M'Rukunga",
      "Kinoti M'Arithi",
      "Makena M'Imanyara",
      "Murithi M'Nabea",
      "Nkatha M'Raria",
      "Kinyua M'Itonga",
      "Gaceri M'Rimberia",
      "Mbaabu M'Kirigia",
      "Karwitha M'Rukaria",
      "Muthomi M'Ndegwa",
      "Kagwiria M'Rintaugu",
      "Koome M'Anampiu",
      "Mukiri M'Raria",
      "Mwebia M'Ikungu",
      "Ciangai M'Rimbere",
    ]),
    invoices: buildInvoices({
      idPrefix: "inv_mru",
      refPrefix: "MRU",
      buyers: NUT_BUYERS,
      commodity: "macadamia kernel",
      origin: "Mombasa",
      grades: ["Style 0", "Style 1", "Style 1S", "Style 2"],
      statuses: HISTORY_11,
      daysAgo: DAYS_11,
      amounts: [31200, 18450, 12600, 24800, 9900, 16750, 7200, 14300, 8800, 20500, 6400],
      currencies: CURRENCY_11,
      kgDivisor: 11,
    }),
  },
  {
    id: "coop_naivasha",
    slug: "naivasha",
    name: "Naivasha Floriculture Co-op",
    phoneStem: "715",
    idStem: 41500000,
    treasurer: {
      id: "acc_treasurer_naivasha",
      full_name: "Naomi Wairimu",
      phone: "+254715000000",
      id_number: "41500000",
    },
    farmers: withKilos(43, [
      "Wairimu Ndung'u",
      "Lemayian ole Saitoti",
      "Njoki Kariuki",
      "Naserian ene Ntutu",
      "Kamau Gitau",
      "Nashipae ene Sadera",
      "Wambui Macharia",
      "Saitoti ole Nkuru",
      "Nyambura Karanja",
      "Naisiae ene Koikai",
      "Mbugua Waweru",
      "Nalangu ene Tipis",
      "Wangui Ngugi",
      "Lenana ole Parkire",
      "Wanjiku Thuo",
      "Simaloi ene Lempaka",
    ]),
    invoices: buildInvoices({
      idPrefix: "inv_nvs",
      refPrefix: "NVS",
      buyers: FLOWER_BUYERS,
      commodity: "cut flowers",
      origin: "Nairobi JKIA",
      grades: ["premium roses", "spray roses", "gypsophila", "hypericum"],
      statuses: ["completed", "completed", "completed", "completed", "completed", "failed", "paid", "converting", "settling", "pending"],
      daysAgo: [230, 200, 170, 140, 110, 75, 30, 14, 6, 1],
      amounts: [8600, 12450, 5400, 9800, 15220, 4300, 7600, 11200, 6900, 13450],
      currencies: ["EUR", "EUR", "GBP", "USD", "EUR", "GBP", "EUR", "USD", "EUR", "GBP"],
      kgDivisor: 8.5,
    }),
  },
];

export const WANJIRU_EXTRA_INVOICES: InvoiceBlueprint[] = buildInvoices({
  idPrefix: "inv_wcr",
  refPrefix: "WCR",
  buyers: CRAFT_BUYERS,
  commodity: "handwoven home goods",
  origin: "Nairobi JKIA",
  grades: ["sisal baskets", "banana-bark trays", "beaded leather", "wool throws"],
  statuses: ["completed", "paid", "converting", "failed"],
  daysAgo: [150, 20, 9, 3],
  amounts: [2400, 1650, 980, 3200],
  currencies: ["USD", "EUR", "GBP", "USD"],
  kgDivisor: 18,
});

const EXPORTER_HISTORY: InvoiceStatus[] = ["completed", "completed", "failed", "paid", "converting", "pending"];
const EXPORTER_DAYS = [200, 120, 50, 24, 11, 2];
const EXPORTER_CCY: Array<"USD" | "EUR" | "GBP"> = ["USD", "EUR", "GBP", "USD", "EUR", "GBP"];

export const EXTRA_EXPORTERS: ExporterCatalog[] = [
  {
    id: "acc_exporter_honey",
    full_name: "Nzisa Mutua (Kitui Highlands Honey)",
    business: "Kitui Highlands Honey",
    phone: "+254722000002",
    id_number: "33000002",
    town: "Kitui",
    invoices: buildInvoices({
      idPrefix: "inv_hny",
      refPrefix: "HNY",
      buyers: HONEY_BUYERS,
      commodity: "raw acacia honey",
      origin: "Mombasa",
      grades: ["Grade A", "comb honey", "creamed", "wildflower"],
      statuses: EXPORTER_HISTORY,
      daysAgo: EXPORTER_DAYS,
      amounts: [4200, 6100, 1800, 3500, 2750, 5400],
      currencies: EXPORTER_CCY,
      kgDivisor: 6,
    }),
  },
  {
    id: "acc_exporter_leather",
    full_name: "Sankale Ole Nkai (Ole Nkai Leather)",
    business: "Ole Nkai Leather",
    phone: "+254722000003",
    id_number: "33000003",
    town: "Kajiado",
    invoices: buildInvoices({
      idPrefix: "inv_lth",
      refPrefix: "LTH",
      buyers: LEATHER_BUYERS,
      commodity: "vegetable-tanned leather",
      origin: "Mombasa",
      grades: ["full-grain hides", "goatskin", "suede", "harness bends"],
      statuses: EXPORTER_HISTORY,
      daysAgo: EXPORTER_DAYS,
      amounts: [8900, 12600, 4100, 7300, 5600, 9800],
      currencies: EXPORTER_CCY,
      kgDivisor: 22,
    }),
  },
  {
    id: "acc_exporter_avocado",
    full_name: "Wangari Mugo (Mugo Avocado Exports)",
    business: "Mugo Avocado Exports",
    phone: "+254722000004",
    id_number: "33000004",
    town: "Murang'a",
    invoices: buildInvoices({
      idPrefix: "inv_avo",
      refPrefix: "AVO",
      buyers: AVOCADO_BUYERS,
      commodity: "Hass avocado",
      origin: "Mombasa",
      grades: ["Class I", "Class I", "Class II", "organic"],
      statuses: EXPORTER_HISTORY,
      daysAgo: EXPORTER_DAYS,
      amounts: [15400, 22100, 6800, 11250, 9400, 17600],
      currencies: EXPORTER_CCY,
      kgDivisor: 1.4,
    }),
  },
  {
    id: "acc_exporter_sisal",
    full_name: "Hamisi Juma (Taita Sisal Works)",
    business: "Taita Sisal Works",
    phone: "+254722000005",
    id_number: "33000005",
    town: "Taita",
    invoices: buildInvoices({
      idPrefix: "inv_sis",
      refPrefix: "SIS",
      buyers: SISAL_BUYERS,
      commodity: "sisal fibre",
      origin: "Mombasa",
      grades: ["UG grade", "3L", "tow", "baler twine"],
      statuses: EXPORTER_HISTORY,
      daysAgo: EXPORTER_DAYS,
      amounts: [7600, 11800, 3200, 5400, 4700, 8900],
      currencies: EXPORTER_CCY,
      kgDivisor: 1.1,
    }),
  },
  {
    id: "acc_exporter_spices",
    full_name: "Amina Yusuf (Lamu Spice House)",
    business: "Lamu Spice House",
    phone: "+254722000006",
    id_number: "33000006",
    town: "Mombasa",
    invoices: buildInvoices({
      idPrefix: "inv_spc",
      refPrefix: "SPC",
      buyers: SPICE_BUYERS,
      commodity: "coastal spices",
      origin: "Mombasa",
      grades: ["vanilla", "cloves", "black pepper", "cardamom"],
      statuses: EXPORTER_HISTORY,
      daysAgo: EXPORTER_DAYS,
      amounts: [3900, 5600, 1400, 2800, 2100, 4500],
      currencies: EXPORTER_CCY,
      kgDivisor: 7,
    }),
  },
];

export function assertCatalogShape(): void {
  if (KIAMBU_FARMERS.length !== 10) throw new Error("Kiambu must keep 10 canonical farmers");
  const kiambuShare = KIAMBU_FARMERS.reduce((sum, farmer) => sum + (farmer.share ?? 0), 0);
  if (kiambuShare !== 100) throw new Error(`Kiambu shares sum to ${kiambuShare}`);

  const expectedFarmers: Record<string, number> = { kericho: 28, meru: 22, naivasha: 16 };
  for (const coop of EXTRA_COOPS) {
    if (coop.farmers.length !== expectedFarmers[coop.slug]) {
      throw new Error(`${coop.slug} has ${coop.farmers.length} farmers`);
    }
    integerShares(coop.farmers.map((farmer) => farmer.kilos));
  }

  if (EXTRA_EXPORTERS.length !== 5) throw new Error("Expected 5 extra exporters");

  const blueprints = [
    ...CANONICAL_INVOICES,
    ...KIAMBU_EXTRA_INVOICES,
    ...WANJIRU_EXTRA_INVOICES,
    ...EXTRA_COOPS.flatMap((coop) => coop.invoices),
    ...EXTRA_EXPORTERS.flatMap((exporter) => exporter.invoices),
  ];
  if (blueprints.length < 75) throw new Error(`Catalog only has ${blueprints.length} invoices`);

  const ids = new Set<string>();
  const refs = new Set<string>();
  for (const invoice of blueprints) {
    if (invoice.amount <= 0) throw new Error(`Non-positive amount on ${invoice.id}`);
    if (ids.has(invoice.id)) throw new Error(`Duplicate invoice id ${invoice.id}`);
    if (refs.has(invoice.reference)) throw new Error(`Duplicate reference ${invoice.reference}`);
    if (invoice.id.length > 64 || invoice.reference.length > 64) {
      throw new Error(`Identifier too long on ${invoice.id}`);
    }
    ids.add(invoice.id);
    refs.add(invoice.reference);
  }

  const names = [
    ...KIAMBU_FARMERS.map((farmer) => farmer.name),
    ...EXTRA_COOPS.flatMap((coop) => coop.farmers.map((farmer) => farmer.name)),
  ];
  if (new Set(names).size !== names.length) throw new Error("Duplicate farmer name in catalog");
}
