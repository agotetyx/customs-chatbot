import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.resolve(__dirname, "../src/assets/demoData.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

const norm = (s) => String(s ?? "").toLowerCase().trim();

function flatten(obj, prefix = "") {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== "object") return [`${prefix}=${String(obj)}`];

  if (Array.isArray(obj)) {
    return obj.flatMap((v, i) => flatten(v, `${prefix}[${i}]`));
  }

  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(...flatten(v, p));
  }
  return out;
}

function parseQuery(input) {
  const q = input.trim();
  if (!q) return { terms: [], filters: {} };

  const tokens = q.match(/"[^"]+"|\S+/g) ?? [];
  const terms = [];
  const filters = {};

  for (const t of tokens) {
    const token = t.replace(/^"|"$/g, "");
    const m = token.match(/^([a-zA-Z_]+):(.+)$/);
    if (m) {
      const key = norm(m[1]);
      const val = norm(m[2].replace(/^"|"$/g, ""));
      if (!filters[key]) filters[key] = [];
      filters[key].push(val);
    } else {
      terms.push(norm(token));
    }
  }

  return { terms, filters };
}

const FILTER_PATHS = {
  name: ["name.primary_name", "name.aliases"],
  alias: ["name.aliases"],
  dob: ["date_of_birth"],
  gender: ["gender"],
  nationality: ["nationality"],
  race: ["race"],
  passport: ["passport_numbers"],
  phone: ["contact.mobile_numbers"],
  mobile: ["contact.mobile_numbers"],
  address: ["contact.address"],
  residency: ["residency_status"],

  vehicle: ["vehicle_number"],
  vehicle_number: ["vehicle_number"],
  vehicle_type: ["vehicle_type"],
  colour: ["colour"],
  color: ["colour"],
  owner: ["registered_owner"],
  risk: ["risk_notes"],

  source: ["source"],
  confidence: ["confidence_level"],
  received_date: ["received_date"],

  case_type: ["case_type"],
  status: ["status"],
  opened_date: ["opened_date"],

  entry_point: ["entry_point"],
  destination: ["destination"],
  departure_date: ["departure_date"],
  return_date: ["return_date"],
  arrival_date: ["arrival_date"],
  pattern: ["travel_pattern_flag"],
};

function getByPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;

  for (const part of parts) {
    if (cur === null || cur === undefined) return [];
    if (Array.isArray(cur)) {
      cur = cur.flatMap((x) => (x ? x[part] : undefined));
    } else {
      cur = cur[part];
    }
  }

  if (cur === null || cur === undefined) return [];
  return Array.isArray(cur) ? cur : [cur];
}

function passesFilters(obj, filters) {
  for (const [k, wantedVals] of Object.entries(filters)) {
    const paths = FILTER_PATHS[k];
    if (!paths) continue;

    const hay = paths
      .flatMap((p) => getByPath(obj, p))
      .map(norm)
      .filter(Boolean);

    const ok = wantedVals.some((w) => hay.some((h) => h.includes(w)));
    if (!ok) return false;
  }
  return true;
}

function passesTerms(obj, terms) {
  if (!terms.length) return true;
  const flat = flatten(obj).map(norm);
  return terms.every((t) => flat.some((f) => f.includes(t)));
}

function searchCollection(arr, input) {
  const { terms, filters } = parseQuery(input);

  return arr
    .map((o) => {
      if (!passesFilters(o, filters)) return null;
      if (!passesTerms(o, terms)) return null;

      return {
        ...o,
        matchedTerms: terms,
        matchedFields: collectMatchedFields(o, terms),
      };
    })
    .filter(Boolean);
}



export function searchAll(input) {
  return {
    persons: searchCollection(data.persons, input),
    vehicles: searchCollection(data.vehicles, input),
    first_info_reports: searchCollection(data.first_info_reports, input),
    cases: searchCollection(data.cases, input),
    trips: searchCollection(data.trips, input),
  };
}

function collectMatchedFields(obj, terms) {
  const matches = new Set();

  const walk = (o, path = "") => {
    if (o === null || o === undefined) return;

    if (typeof o !== "object") {
      const val = norm(o);
      for (const t of terms) {
        if (val.includes(t)) matches.add(path);
      }
      return;
    }

    if (Array.isArray(o)) {
      o.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }

    for (const [k, v] of Object.entries(o)) {
      walk(v, path ? `${path}.${k}` : k);
    }
  };

  walk(obj);
  return Array.from(matches);
}
