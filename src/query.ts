import data from "./assets/demoData.json";

export type SearchResults = {
  persons: any[];
  vehicles: any[];
  first_info_reports: any[];
  cases: any[];
  trips: any[];
};

const norm = (s: any) => String(s ?? "").toLowerCase().trim();

/** Flatten any object into searchable strings: ["path=value", ...] */
function flatten(obj: any, prefix = ""): string[] {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== "object") return [`${prefix}=${String(obj)}`];

  if (Array.isArray(obj)) {
    return obj.flatMap((v, i) => flatten(v, `${prefix}[${i}]`));
  }

  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(...flatten(v, p));
  }
  return out;
}

/** Extract search constraints like: nationality:malaysian dob:1984-09-02 "john bahru" */
function parseQuery(input: string): { terms: string[]; filters: Record<string, string[]> } {
  const q = input.trim();
  if (!q) return { terms: [], filters: {} };

  // split by spaces but keep quoted chunks
  const tokens = q.match(/"[^"]+"|\S+/g) ?? [];
  const terms: string[] = [];
  const filters: Record<string, string[]> = {};

  for (const t of tokens) {
    const token = t.replace(/^"|"$/g, ""); // strip quotes
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

/**
 * Map human filter keys → searchable paths.
 * (No schema changes; this is just routing for filtering.)
 */
const FILTER_PATHS: Record<string, string[]> = {
  // persons
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

  // vehicles
  vehicle: ["vehicle_number"],
  vehicle_number: ["vehicle_number"],
  vehicle_type: ["vehicle_type"],
  colour: ["colour"],
  color: ["colour"],
  owner: ["registered_owner"],
  risk: ["risk_notes"],

  // FI
  source: ["source"],
  confidence: ["confidence_level"],
  received_date: ["received_date"],

  // cases
  case_type: ["case_type"],
  status: ["status"],
  opened_date: ["opened_date"],

  // trips
  entry_point: ["entry_point"],
  destination: ["destination"],
  departure_date: ["departure_date"],
  return_date: ["return_date"],
  arrival_date: ["arrival_date"],
  pattern: ["travel_pattern_flag"]
};

function getByPath(obj: any, path: string): any[] {
  // supports dotted paths; arrays become concatenated results
  const parts = path.split(".");
  let cur: any = obj;

  for (const part of parts) {
    if (cur === null || cur === undefined) return [];
    if (Array.isArray(cur)) {
      // if current is array, map down and flatten
      cur = cur.flatMap((x) => (x ? x[part] : undefined));
    } else {
      cur = cur[part];
    }
  }

  if (cur === null || cur === undefined) return [];
  return Array.isArray(cur) ? cur : [cur];
}

function passesFilters(obj: any, filters: Record<string, string[]>): boolean {
  for (const [k, wantedVals] of Object.entries(filters)) {
    const paths = FILTER_PATHS[k];
    if (!paths) {
      // unknown filter key: treat as generic term on whole object (don’t block)
      continue;
    }

    const hay = paths
      .flatMap((p) => getByPath(obj, p))
      .map(norm)
      .filter(Boolean);

    // For a key with multiple values, match ANY (OR) by default
    const ok = wantedVals.some((w) => hay.some((h) => h.includes(w)));
    if (!ok) return false;
  }

  return true;
}

function passesTerms(obj: any, terms: string[]): boolean {
  if (!terms.length) return true;

  const flat = flatten(obj).map(norm);
  // All terms must match somewhere (AND)
  return terms.every((t) => flat.some((f) => f.includes(t)));
}

function searchCollection(arr: any[], input: string): any[] {
  const { terms, filters } = parseQuery(input);
  return arr.filter((o) => passesFilters(o, filters) && passesTerms(o, terms));
}

export function searchAll(input: string): SearchResults {
  return {
    persons: searchCollection(data.persons, input),
    vehicles: searchCollection(data.vehicles, input),
    first_info_reports: searchCollection(data.first_info_reports, input),
    cases: searchCollection(data.cases, input),
    trips: searchCollection(data.trips, input)
  };
}

// linking helpers
export function getLinkedVehiclesForPerson(personId: string) {
  return data.vehicles.filter(
    (v: any) => v.registered_owner === personId || (v.known_users ?? []).includes(personId)
  );
}
export function getLinkedCasesForPerson(personId: string) {
  return data.cases.filter((c: any) => (c.linked_person_ids ?? []).includes(personId));
}
export function getLinkedFIsForPerson(personId: string) {
  return data.first_info_reports.filter((fi: any) => (fi.linked_person_ids ?? []).includes(personId));
}
export function getTripsForPerson(personId: string) {
  return data.trips.filter((t: any) => t.person_id === personId);
}
export function getEntityById(type: string, id: string) {
  const map: any = {
    person: data.persons,
    vehicle: data.vehicles,
    case: data.cases,
    fi: data.first_info_reports,
    trip: data.trips
  };
  const arr = map[type] ?? [];
  const keyMap: any = {
    person: "person_id",
    vehicle: "vehicle_id",
    case: "case_id",
    fi: "first_info_id",
    trip: "trip_id"
  };
  const key = keyMap[type];
  return arr.find((x: any) => x?.[key] === id) ?? null;
}
