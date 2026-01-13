import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Fuse from "fuse.js";

const require = createRequire(import.meta.url);
const pdfParseModule = require("pdf-parse");
const pdfParse =
  typeof pdfParseModule === "function"
    ? pdfParseModule
    : typeof pdfParseModule?.default === "function"
    ? pdfParseModule.default
    : typeof pdfParseModule?.pdf === "function"
    ? pdfParseModule.pdf
    : null;

if (!pdfParse) {
  throw new Error(
    "pdf-parse import failed: could not resolve a callable function export."
  );
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const DOCS_DIR = path.join(__dirname, "docs");
const norm = (s) => String(s ?? "").toLowerCase();

function parseDocFilename(filename) {
  // persons_P-0006.pdf
  // vehicles_V-010.pdf
  // first_info_reports_FI-2025-0719.pdf
  // trips_P-0016.pdf
  // cases_SC-TOB-2025-00112.pdf
  const base = filename.replace(/\.pdf$/i, "");
  const idx = base.indexOf("_");
  if (idx === -1) return null;

  const prefix = base.slice(0, idx);
  const id = base.slice(idx + 1);

  const map = {
    persons: "person",
    vehicles: "vehicle",
    cases: "case",
    first_info_reports: "fi",
    trips: "trip",
  };

  const entity_type = map[prefix];
  if (!entity_type) return null;

  return { entity_type, entity_id: id };
}

function buildSnippet(text, tokens, windowSize = 240) {
  const t = String(text ?? "");
  const lower = t.toLowerCase();

  let bestIdx = -1;
  for (const tok of tokens) {
    const at = lower.indexOf(tok);
    if (at !== -1 && (bestIdx === -1 || at < bestIdx)) bestIdx = at;
  }

  if (bestIdx === -1) return t.slice(0, windowSize).replace(/\s+/g, " ").trim();

  const start = Math.max(0, bestIdx - Math.floor(windowSize / 3));
  const end = Math.min(t.length, start + windowSize);
  return t.slice(start, end).replace(/\s+/g, " ").trim();
}

function parseQuery(input) {
  const q = input.trim();
  if (!q) return { terms: [], filters: {} };

  const tokens = q.match(/"[^"]+"|\S+/g) ?? [];
  const terms = [];
  const filters = {};

  for (const raw of tokens) {
    const token = raw.replace(/^"|"$/g, "");
    const m = token.match(/^([a-zA-Z_]+):(.+)$/);
    if (m) {
      const key = norm(m[1]);
      const val = norm(m[2].replace(/^"|"$/g, ""));
      (filters[key] ||= []).push(val);
    } else {
      terms.push(norm(token));
    }
  }
  return { terms, filters };
}

// map your key:value filters to JSON fields for doc metadata filtering
const FILTERS = {
  // persons
  nationality: (p) => [p?.nationality],
  gender: (p) => [p?.gender],
  dob: (p) => [p?.date_of_birth],
  passport: (p) => (p?.passport_numbers ?? []),
  phone: (p) => (p?.contact?.mobile_numbers ?? []),
  address: (p) => [p?.contact?.address],

  // vehicles
  vehicle: (v) => [v?.vehicle_number, v?.vehicle_id],
  vehicle_number: (v) => [v?.vehicle_number],
  vehicle_type: (v) => [v?.vehicle_type],
  colour: (v) => [v?.colour],
  color: (v) => [v?.colour],

  // FI
  source: (fi) => [fi?.source],
  confidence: (fi) => [fi?.confidence_level],
  received_date: (fi) => [fi?.received_date],

  // cases
  status: (c) => [c?.status],
  case_type: (c) => [c?.case_type],
  opened_date: (c) => [c?.opened_date],

  // trips
  entry_point: (t) => [t?.entry_point],
  destination: (t) => [t?.destination],
};

function arrayHay(val) {
  return (Array.isArray(val) ? val : [val]).map(norm).filter(Boolean);
}

function passesFilters(entity_type, entity_json, filters) {
  const obj = entity_json;
  if (!filters || !Object.keys(filters).length) return true;
  if (!obj) return false;

  for (const [k, wanted] of Object.entries(filters)) {
    const fn = FILTERS[k];
    if (!fn) continue; // unknown filter: ignore (don’t block)
    const hay = arrayHay(fn(obj));
    const ok = wanted.some((w) => hay.some((h) => h.includes(w)));
    if (!ok) return false;
  }
  return true;
}

export async function buildDocIndex({ data }) {
  if (!fs.existsSync(DOCS_DIR)) {
    console.warn(`[docs] Missing folder: ${DOCS_DIR}`);
    return { docs: [], fuse: null };
  }

  const pdfs = fs.readdirSync(DOCS_DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
  const docs = [];

  for (const filename of pdfs) {
    const parsed = parseDocFilename(filename);
    if (!parsed) continue;

    const fullPath = path.join(DOCS_DIR, filename);
    const buf = fs.readFileSync(fullPath);
    const parsedPdf = await pdfParse(buf);
    const text = parsedPdf.text ?? "";

    // attach FULL JSON object as metadata (your request)
    let entity_json = null;

    if (parsed.entity_type === "person") {
      entity_json = (data.persons ?? []).find((p) => p.person_id === parsed.entity_id) ?? null;
    } else if (parsed.entity_type === "vehicle") {
      entity_json = (data.vehicles ?? []).find((v) => v.vehicle_id === parsed.entity_id) ?? null;
    } else if (parsed.entity_type === "case") {
      entity_json = (data.cases ?? []).find((c) => c.case_id === parsed.entity_id) ?? null;
    } else if (parsed.entity_type === "fi") {
      entity_json =
        (data.first_info_reports ?? []).find((fi) => fi.first_info_id === parsed.entity_id) ?? null;
    } else if (parsed.entity_type === "trip") {
      const trips = (data.trips ?? []).filter((t) => t.person_id === parsed.entity_id);
      entity_json = trips.length ? { person_id: parsed.entity_id, trips } : null;
    }

    docs.push({
      doc_id: `DOC-${parsed.entity_type}-${parsed.entity_id}`,
      entity_type: parsed.entity_type,
      entity_id: parsed.entity_id,
      filename,
      public_path: `/docs/${filename}`,
      text,
      text_lower: norm(text),
      entity_json,
    });
  }

  const fuse = new Fuse(docs, {
    includeScore: true,
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: ["filename", "entity_id", "text"],
  });

  console.log(`[docs] Indexed ${docs.length} PDFs from ${DOCS_DIR}`);
  return { docs, fuse };
}

export function searchDocuments(docIndex, rawQuery, { limit = 20 } = {}) {
  const q = String(rawQuery ?? "").trim();
  if (!q || !docIndex?.docs?.length) return [];

  const { terms, filters } = parseQuery(q);
  const tokensForSnippet = [...terms, ...Object.values(filters).flat()].filter(Boolean).slice(0, 12);

  const candidates = docIndex.fuse ? docIndex.fuse.search(q).slice(0, 80) : [];

  const hits = candidates
    .map((h) => {
      const d = h.item;

      if (!passesFilters(d.entity_type, d.entity_json, filters)) return null;

      // optional: require all plain terms to appear somewhere (text/filename/id/json)
      if (terms.length) {
        const jsonFlat = norm(JSON.stringify(d.entity_json ?? {}));
        const hay = `${norm(d.filename)} ${norm(d.entity_id)} ${d.text_lower} ${jsonFlat}`;
        if (!terms.every((t) => hay.includes(t))) return null;
      }

      const matchScore = typeof h.score === "number" ? 1 - h.score : 0.5;

      const matchedFields = [];
      const qLower = q.toLowerCase();
      if (d.filename.toLowerCase().includes(qLower)) matchedFields.push("filename");
      if (String(d.entity_id).toLowerCase().includes(qLower)) matchedFields.push("entity_id");
      if (d.text_lower.includes(qLower)) matchedFields.push("text");
      if (!matchedFields.length) matchedFields.push("fuzzy");

      return {
        doc_id: d.doc_id,
        entity_type: d.entity_type,
        entity_id: d.entity_id,
        filename: d.filename,
        public_path: d.public_path,
        snippet: buildSnippet(d.text, tokensForSnippet),
        matchedFields,
        matchScore: Number(matchScore.toFixed(4)),
        entity_json: d.entity_json, // full metadata
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);

  return hits;
}
