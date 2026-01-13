// server/docIndex.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fuse from "fuse.js";

console.log("[docIndex] VERSION = 2026-01-13-uint8-fix");

// ESM-friendly PDF text extraction
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DOCS_DIR = path.join(__dirname, "docs");

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

function parseQueryTokens(q) {
  const text = String(q ?? "").trim();
  if (!text) return [];

  // Keep quoted phrases intact
  const tokens = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(text))) {
    const t = (m[1] ?? m[2] ?? "").trim();
    if (!t) continue;
    tokens.push(t);
  }

  // Also split key:value into ["key", "value"] to increase recall
  const expanded = [];
  for (const t of tokens) {
    expanded.push(t);
    const idx = t.indexOf(":");
    if (idx > 0 && idx < t.length - 1) {
      expanded.push(t.slice(0, idx));
      expanded.push(t.slice(idx + 1));
    }
  }

  return [...new Set(expanded.map((x) => x.trim()).filter(Boolean))];
}

function inferDocMetaFromFilename(filename) {
  // persons_P-0006.pdf
  // vehicles_V-018.pdf
  // first_info_reports_FI-2025-1208.pdf
  // cases_SC-TOB-2025-00112.pdf
  // trips_P-0006.pdf
  const base = filename.replace(/\.(pdf|docx)$/i, "");
  const [prefix, rest] = base.split("_", 2);

  const meta = {
    filename,
    entity_type: prefix ?? "document",
    entity_id: rest ?? base,
    person_id: null,
    case_id: null,
    vehicle_id: null,
    first_info_id: null,
    trip_id: null,
  };

  const id = rest ?? "";

  if (/^P-\d{4}$/i.test(id)) meta.person_id = id.toUpperCase();
  if (/^V-\d{3}$/i.test(id)) meta.vehicle_id = id.toUpperCase();
  if (/^FI-\d{4}-\d{4}$/i.test(id)) meta.first_info_id = id.toUpperCase();
  if (/^SC-/i.test(id)) meta.case_id = id.toUpperCase();

  // trip PDFs in your dump are named trips_P-0001.pdf etc
  if (prefix === "trips" && /^P-\d{4}$/i.test(id)) meta.trip_id = base;

  return meta;
}

function attachJsonMetadata(meta, data) {
  const enriched = { ...meta };

  try {
    if (meta.person_id) {
      const p = (data?.persons ?? []).find((x) => x.person_id === meta.person_id);
      if (p) enriched.json_meta = p;
    } else if (meta.vehicle_id) {
      const v = (data?.vehicles ?? []).find((x) => x.vehicle_id === meta.vehicle_id);
      if (v) enriched.json_meta = v;
    } else if (meta.case_id) {
      const c = (data?.cases ?? []).find((x) => x.case_id === meta.case_id);
      if (c) enriched.json_meta = c;
    } else if (meta.first_info_id) {
      const fi = (data?.first_info_reports ?? []).find(
        (x) => x.first_info_id === meta.first_info_id
      );
      if (fi) enriched.json_meta = fi;
    }
  } catch {
    // ignore
  }

  return enriched;
}

async function extractPdfText(buffer) {
  // pdfjs-dist expects Uint8Array, not Node Buffer
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  const loadingTask = pdfjsLib.getDocument({ data: uint8 });
  const pdf = await loadingTask.promise;

  let out = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items.map((it) => it.str).filter(Boolean);
    out += strings.join(" ") + "\n";
  }
  return out;
}

function buildSnippet(text, tokens) {
  const t = String(text ?? "");
  const lower = t.toLowerCase();

  let bestIdx = -1;

  for (const rawTok of tokens) {
    const tok = rawTok.toLowerCase();
    if (!tok || tok.length < 2) continue;
    const idx = lower.indexOf(tok);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
    }
  }

  if (bestIdx === -1) {
    const trimmed = t.replace(/\s+/g, " ").trim();
    return trimmed.length > 220 ? trimmed.slice(0, 220) + "…" : trimmed;
  }

  const start = Math.max(0, bestIdx - 90);
  const end = Math.min(t.length, bestIdx + 180);
  const snippet = t.slice(start, end).replace(/\s+/g, " ").trim();

  return (start > 0 ? "…" : "") + snippet + (end < t.length ? "…" : "");
}

export async function buildDocIndex({ data, docsDir = DEFAULT_DOCS_DIR } = {}) {
  const files = await fs.readdir(docsDir).catch(() => []);
  const pdfs = files.filter((f) => /\.pdf$/i.test(f));

  const docs = [];

  for (const filename of pdfs) {
    const absPath = path.join(docsDir, filename);

    try {
      const buf = await fs.readFile(absPath);
      const text = await extractPdfText(buf);

      const baseMeta = inferDocMetaFromFilename(filename);
      const meta = attachJsonMetadata(baseMeta, data);

      const metaText = meta.json_meta ? JSON.stringify(meta.json_meta) : "";

      docs.push({
        doc_id: filename,
        filename,
        title: filename,
        entity_type: meta.entity_type,
        entity_id: meta.entity_id,
        meta,
        text,
        public_path: `/docs/${encodeURIComponent(filename)}`,
        _search_blob: `${filename}\n${metaText}\n${text}`.toLowerCase(),
      });
    } catch (err) {
      console.warn(`[docIndex] Skipping ${filename}:`, err?.message ?? err);
    }
  }

  // ✅ log once, after processing all PDFs
  console.log(`[docIndex] Indexed ${docs.length}/${pdfs.length} PDFs from ${docsDir}`);

  const fuse = new Fuse(docs, {
    includeScore: true,
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: "title", weight: 0.2 },
      { name: "metaText", weight: 0.35 },
      { name: "text", weight: 0.45 },
    ],
    // ✅ handle Fuse passing pathKey as array in some versions
    getFn: (obj, pathKey) => {
      const key = Array.isArray(pathKey) ? pathKey[0] : pathKey;
      if (key === "metaText") return obj.meta ? JSON.stringify(obj.meta) : "";
      return obj[key];
    },
  });

  return { docs, fuse, built_at: new Date().toISOString() };
}

export function searchDocuments(docIndex, query, { limit = 20 } = {}) {
  if (!docIndex?.docs?.length) return [];

  const tokens = parseQueryTokens(query);
  const q = tokens.join(" ").trim();
  if (!q) return [];

  const results = docIndex.fuse.search(q).slice(0, limit);

  return results.map((r) => {
    const d = r.item;

    const snippet = buildSnippet(d.text, tokens);

    const matched_terms = tokens
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .filter((t) => d._search_blob.includes(t.toLowerCase()))
      .slice(0, 12);

    return {
      doc_id: d.doc_id,
      title: d.title,
      filename: d.filename,
      entity_type: d.entity_type,
      entity_id: d.entity_id,
      meta: d.meta,
      public_path: d.public_path,
      snippet,
      matched_terms,
      score: typeof r.score === "number" ? Number(r.score.toFixed(4)) : null,
    };
  });
}
