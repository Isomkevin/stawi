import { writeFileSync } from "node:fs";

const given = [
  "Wanjiku", "Njeri", "Wambui", "Nyambura", "Wangari", "Wairimu", "Nyokabi", "Mumbi",
  "Waithira", "Njoki", "Wanjiru", "Wangui", "Muthoni", "Nyawira", "Waceke", "Gathoni",
  "Wanja", "Njambi", "Wahu", "Wamuyu", "Nyaguthii", "Wanjira", "Mukami", "Gathigia",
  "Kagendo", "Makena", "Karambu", "Kawira", "Nkatha", "Achieng", "Atieno", "Awino",
  "Adhiambo", "Chebet", "Jeruto", "Jepkemboi", "Faith", "Grace", "Esther", "Lucy",
  "Mary", "Ann", "Jane", "Rose", "Alice", "Mercy", "Joyce", "Hannah", "Ruth", "Sarah",
  "Lydia", "Catherine", "Beatrice", "Florence", "Agnes", "Margaret", "Pauline", "Doris",
  "Irene", "Naomi", "Rebecca", "Tabitha", "Eunice", "Gladys", "Hellen", "Caroline",
  "Veronica", "Susan", "Elizabeth", "Christine", "Rosemary", "Janet", "Cecilia", "Monica",
  "Consolata", "Peris", "Edith", "Salome", "Loise", "Teresia", "Jacinta", "Charity",
  "Jackline", "Lilian", "Millicent", "Nancy", "Patricia", "Sharon", "Vivian", "Yvonne",
  "Halima", "Fatuma", "Amina", "Rehema", "Zawadi", "Neema",
  "Joseph", "Peter", "Samuel", "David", "John", "James", "Daniel", "Paul",
  "Stephen", "Francis", "George", "Charles", "Patrick", "Simon", "Thomas", "Andrew",
  "Michael", "Robert", "Richard", "Edward", "Antony", "Bernard", "Christopher", "Dominic",
  "Emmanuel", "Felix", "Geoffrey", "Henry", "Isaac", "Jacob", "Kenneth", "Lawrence",
  "Martin", "Nicholas", "Philip", "Raymond", "Solomon", "Timothy", "Vincent", "Wilson",
  "Benjamin", "Collins", "Dennis", "Erick", "Fredrick", "Gerald", "Harrison", "Ibrahim",
  "Jackson", "Kelvin", "Leonard", "Moses", "Nathan", "Pius", "Reuben", "Silas",
  "Titus", "Victor", "Wesley", "Boniface", "Clement", "Duncan", "Evans", "Gabriel",
  "Humphrey", "Josphat", "Kennedy", "Laban", "Mark", "Nelson", "Peterson", "Alfred",
  "Brian", "Cyrus", "Eliud", "Festus", "Gideon", "Hillary", "Justus", "Kevin",
  "Morris", "Nixon", "Stanley", "Tobias", "Wilfred", "Yusuf", "Zakayo", "Amos",
  "Cornelius", "Daudi", "Godfrey", "Hezron", "Isaiah", "Joel", "Kiprono", "Benard",
];

const family = [
  "Mwangi", "Kamau", "Njoroge", "Kariuki", "Kimani", "Maina", "Gitau", "Waweru",
  "Karanja", "Muturi", "Macharia", "Ngugi", "Mbugua", "Chege", "Ndegwa", "Irungu",
  "Muchiri", "Gichuru", "Mungai", "Njenga", "Thuo", "Waithaka", "Ndungu", "Muhia",
  "Ndirangu", "Gathogo", "Kibicho", "Warui", "Hinga", "Kinyua", "Muriuki", "Gakuo",
  "Njau", "Kioni", "Muthama", "Musyoka", "Mutua", "Wambua", "Mutiso", "Kioko",
  "Otieno", "Omondi", "Ochieng", "Odhiambo", "Okoth", "Owino", "Cheruiyot", "Langat",
  "Rotich", "Kiptoo", "Kosgei", "Bett", "Korir", "Rono", "Kirui", "Mwenda",
  "Mwirigi", "Kinoti", "Koome", "Kirimi",
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distribute(weights, total) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map((x) => Math.floor(x));
  let rem = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < rem; k++) floors[order[k].i] += 1;
  return floors;
}

const N = 400;
const rand = mulberry32(20260929);
const pairs = [];
for (const g of given) {
  for (const f of family) pairs.push(`${g} ${f}`);
}
for (let i = pairs.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
}
const names = pairs.slice(0, N).sort((a, b) => a.localeCompare(b));
if (new Set(names).size !== N) throw new Error("duplicate names");

// Most members are smallholders. A short tail of larger farms takes the rest of the 100%.
const weights = names.map(() => {
  const r = rand();
  if (r < 0.62) return 0.02;
  if (r < 0.88) return 0.6 + rand();
  return 6 + rand() * 18;
});
let extras = distribute(weights, N);
const CAP = 14;
for (let guard = 0; guard < 30 && extras.some((e) => e > CAP); guard++) {
  let spill = 0;
  for (let i = 0; i < extras.length; i++) {
    if (extras[i] > CAP) {
      spill += extras[i] - CAP;
      extras[i] = CAP;
    }
  }
  const room = [];
  for (let i = 0; i < extras.length; i++) if (extras[i] < CAP) room.push(i);
  let r = 0;
  while (spill > 0) {
    if (room.length === 0) throw new Error("cannot place leftover share");
    const i = room[r % room.length];
    if (extras[i] < CAP) {
      extras[i] += 1;
      spill -= 1;
      if (extras[i] >= CAP) room.splice(r % room.length, 1);
      else r += 1;
    } else {
      room.splice(r % room.length, 1);
    }
  }
}

const eighths = extras.map((e) => 1 + e);
if (eighths.reduce((a, b) => a + b, 0) !== N * 2) {
  throw new Error(`eighths ${eighths.reduce((a, b) => a + b, 0)} expected ${N * 2}`);
}

const KG_PER_EIGHTH = 150;
const rows = names.map((name, i) => {
  const share = eighths[i] * 0.125;
  const kilos = eighths[i] * KG_PER_EIGHTH;
  const phone = `07${String(17400001 + i)}`;
  return { name, phone, share, kilos };
});

const shareSum = rows.reduce((s, r) => s + r.share, 0);
if (shareSum !== 100) throw new Error(`share sum ${shareSum}`);
const phones = new Set(rows.map((r) => r.phone));
if (phones.size !== N) throw new Error("duplicate phones");
for (const r of rows) {
  if (!/^07\d{8}$/.test(r.phone)) throw new Error(`bad phone ${r.phone}`);
  const normalized = `+254${r.phone.slice(1)}`;
  if (!/^\+2547\d{8}$/.test(normalized)) throw new Error(`bad norm ${normalized}`);
  if (!(r.share > 0 && r.share <= 100)) throw new Error(`bad share ${r.share}`);
  if (!Number.isInteger(r.kilos) || r.kilos <= 0) throw new Error(`bad kilos ${r.kilos}`);
}

const lines = ["name,phone,share,kilos"];
for (const r of rows) lines.push(`${r.name},${r.phone},${r.share},${r.kilos}`);
const file = "C:/Users/Administrator/Desktop/stawi/docs/demo-kiambu-farmers.csv";
writeFileSync(file, `${lines.join("\r\n")}\r\n`);

const kilos = rows.reduce((s, r) => s + r.kilos, 0);
const min = Math.min(...rows.map((r) => r.share));
const max = Math.max(...rows.map((r) => r.share));
console.log(JSON.stringify({ farmers: N, shareSum, kilos, minShare: min, maxShare: max, first: rows[0], last: rows[N - 1] }));
