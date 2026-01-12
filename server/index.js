// server/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";

import { searchAll } from "./query.js";
import data from "../src/assets/demoData.json" assert { type: "json" };

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- OpenAI / ChatGPT setup ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

if (!OPENAI_API_KEY) {
  console.warn("[WARN] OPENAI_API_KEY is not set. /chat will fall back to deterministic search.");
}

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ---------- helpers (deterministic) ----------
const norm = (s) => String(s ?? "").toLowerCase().trim();

function findPersonMatchesByName(name) {
  const n = norm(name);
  if (!n) return [];
  return (data.persons ?? []).filter((p) => {
    const primary = norm(p?.name?.primary_name);
    const aliases = (p?.name?.aliases ?? []).map(norm);
    return primary.includes(n) || aliases.some((a) => a.includes(n));
  });
}

function tripsForPersonOnDate(personId, date) {
  return (data.trips ?? []).filter((t) => {
    if (t.person_id !== personId) return false;
    return t.departure_date === date || t.return_date === date || t.arrival_date === date;
  });
}

function casesForPerson(personId) {
  return (data.cases ?? []).filter((c) => (c.linked_person_ids ?? []).includes(personId));
}

// ---------- LLM intent schema ----------
const ParsedOutSchema = z.union([
  z.object({ action: z.literal("search"), query: z.string().min(1) }).strict(),

  z
    .object({
      action: z.literal("trip_destination_on_date"),
      person_id: z.string().regex(/^P-\d{4}$/).optional(),
      person_name: z.string().min(1).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .strict(),

  z
    .object({
      action: z.literal("get_case_details_for_person"),
      person_id: z.string().regex(/^P-\d{4}$/),
    })
    .strict(),

  z
    .object({
      action: z.literal("clarify"),
      question: z.string().min(1),
    })
    .strict(),
]);

function systemPrompt() {
  return (
    "You are a strict intent router for a customs search tool. Return ONLY JSON.\n\n" +
    "Choose exactly one action:\n" +
    '1) {"action":"search","query":"..."}\n' +
    '2) {"action":"trip_destination_on_date","person_id":"P-0006","date":"YYYY-MM-DD"} OR {"action":"trip_destination_on_date","person_name":"...","date":"YYYY-MM-DD"}\n' +
    '3) {"action":"get_case_details_for_person","person_id":"P-0006"}\n' +
    '4) {"action":"clarify","question":"..."}\n\n' +
    "Routing rules:\n" +
    "- If the user asks where someone went on a specific date, use trip_destination_on_date.\n" +
    "- If user provides a person_id like P-0006, use person_id. Otherwise use person_name.\n" +
    "- If user asks for case details for a person_id, use get_case_details_for_person.\n" +
    "- If you are missing a required detail (name/id/date), ask ONE clarification question.\n" +
    "- Otherwise default to search with the original keywords.\n\n" +
    "Examples:\n" +
    'User: "where did Rajiv Menon go on 2025-03-19"\n' +
    'Output: {"action":"trip_destination_on_date","person_name":"Rajiv Menon","date":"2025-03-19"}\n' +
    'User: "give me case details for P-0006"\n' +
    'Output: {"action":"get_case_details_for_person","person_id":"P-0006"}\n'
  );
}

function jsonSchemaForParser() {
  return {
    name: "customs_intent_router",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "query"],
          properties: {
            action: { const: "search" },
            query: { type: "string", minLength: 1 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "date"],
          properties: {
            action: { const: "trip_destination_on_date" },
            person_id: { type: "string", pattern: "^P-\\d{4}$" },
            person_name: { type: "string", minLength: 1 },
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
          anyOf: [{ required: ["person_id"] }, { required: ["person_name"] }],
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "person_id"],
          properties: {
            action: { const: "get_case_details_for_person" },
            person_id: { type: "string", pattern: "^P-\\d{4}$" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["action", "question"],
          properties: {
            action: { const: "clarify" },
            question: { type: "string", minLength: 1 },
          },
        },
      ],
    },
  };
}

async function parseToStructuredQuery(userText) {
  const text = String(userText ?? "").trim();

  // --- deterministic pre-router (beats LLM laziness) ---
  // where did <name> go on YYYY-MM-DD
  const m1 = text.match(/^where did\s+(.+?)\s+go on\s+(\d{4}-\d{2}-\d{2})\??$/i);
  if (m1) {
    return { action: "trip_destination_on_date", person_name: m1[1].trim(), date: m1[2] };
  }

  // give me case details for P-0006
  const m2 = text.match(/^give me case details for\s+(P-\d{4})\b/i);
  if (m2) {
    return { action: "get_case_details_for_person", person_id: m2[1] };
  }

  // Fallback: keep app functional even if OpenAI isn't configured
  if (!openai) return { action: "search", query: text };

  try {
    const resp = await openai.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: text },
      ],
      response_format: { type: "json_schema", json_schema: jsonSchemaForParser() },
      temperature: 0,
    });

    const outText = resp.output_text ?? "";

    let json;
    try {
      json = JSON.parse(outText);
    } catch {
      return { action: "clarify", question: "I couldn’t parse that. Can you rephrase your request?" };
    }

    const validated = ParsedOutSchema.safeParse(json);
    if (!validated.success) {
      return {
        action: "clarify",
        question:
          'I couldn’t interpret that cleanly. Try: "male malaysia chinese", "give me case details for P-0006", or "where did Rajiv Menon go on 2025-03-19".',
      };
    }

    return validated.data;
  } catch (err) {
    console.error("[OpenAI parse] error:", err);
    return { action: "search", query: text };
  }
}

// --- API ---
app.post("/chat", async (req, res) => {
  try {
    const message = req.body?.message;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        assistantText: "Message is required.",
        parsedQuery: null,
        results: null,
        clarification: true,
      });
    }

    // 1) Parse intent -> action JSON
    const parsed = await parseToStructuredQuery(message);

    console.log("–––––––––––––––––––––");
    console.log("user:", message);
    console.log("[intent]:", parsed);

    // 2) Clarification intent: no search
    if (parsed?.action === "clarify") {
      return res.json({
        assistantText: parsed.question,
        parsedQuery: null,
        results: null,
        clarification: true,
      });
    }

    // 3) Deterministic handler: trip destination on date
    if (parsed?.action === "trip_destination_on_date") {
      const date = parsed.date;

      // resolve person
      let person = null;

      if (parsed.person_id) {
        person = (data.persons ?? []).find((p) => p.person_id === parsed.person_id) || null;
        if (!person) {
          return res.json({
            assistantText: `No person found for ${parsed.person_id}.`,
            parsedQuery: null,
            results: null,
            clarification: true,
          });
        }
      } else {
        const matches = findPersonMatchesByName(parsed.person_name);
        if (matches.length === 0) {
          return res.json({
            assistantText: `No person found matching "${parsed.person_name}".`,
            parsedQuery: null,
            results: null,
            clarification: true,
          });
        }
        if (matches.length > 1) {
          return res.json({
            assistantText: `Multiple people match "${parsed.person_name}". Which person_id? ${matches
              .map((m) => `${m.person_id} (${m.name?.primary_name ?? "Unknown"})`)
              .join(", ")}`,
            parsedQuery: null,
            results: { persons: matches, vehicles: [], first_info_reports: [], cases: [], trips: [] },
            clarification: true,
          });
        }
        person = matches[0];
      }

      const trips = tripsForPersonOnDate(person.person_id, date);

      if (trips.length === 0) {
        return res.json({
          assistantText: `No trips found for ${person.name?.primary_name ?? person.person_id} on ${date}.`,
          parsedQuery: null,
          results: { persons: [person], vehicles: [], first_info_reports: [], cases: [], trips: [] },
          clarification: false,
        });
      }

      if (trips.length === 1) {
        const t = trips[0];
        return res.json({
          assistantText: `${person.name?.primary_name ?? person.person_id} went to ${t.destination} on ${date} via ${t.entry_point}.`,
          parsedQuery: null,
          results: { persons: [person], vehicles: [], first_info_reports: [], cases: [], trips },
          clarification: false,
        });
      }

      return res.json({
        assistantText: `Found ${trips.length} trips for ${person.name?.primary_name ?? person.person_id} on ${date}. Which one—by entry point or vehicle?`,
        parsedQuery: null,
        results: { persons: [person], vehicles: [], first_info_reports: [], cases: [], trips },
        clarification: true,
      });
    }

    // 4) Deterministic handler: case details for person
    if (parsed?.action === "get_case_details_for_person") {
      const person = (data.persons ?? []).find((p) => p.person_id === parsed.person_id) || null;
      if (!person) {
        return res.json({
          assistantText: `No person found for ${parsed.person_id}.`,
          parsedQuery: null,
          results: null,
          clarification: true,
        });
      }

      const cases = casesForPerson(parsed.person_id);

      return res.json({
        assistantText: `Found ${cases.length} linked case(s) for ${parsed.person_id} (${person.name?.primary_name ?? "Unknown"}).`,
        parsedQuery: null,
        results: { persons: [person], vehicles: [], first_info_reports: [], cases, trips: [] },
        clarification: false,
      });
    }

    // 5) Deterministic full-text search (existing engine)
    if (parsed?.action === "search") {
      const parsedQuery = parsed.query;
      const results = searchAll(parsedQuery);

      console.log("query:", parsedQuery);
      console.log("counts:", {
        persons: results.persons.length,
        vehicles: results.vehicles.length,
        cases: results.cases.length,
        first_info_reports: results.first_info_reports.length,
        trips: results.trips.length,
      });

      return res.json({
        assistantText: `Searching using interpreted query: ${parsedQuery}`,
        parsedQuery,
        results,
        clarification: false,
      });
    }

    // last resort (shouldn’t happen if schema is enforced)
    return res.json({
      assistantText: "Unsupported intent. Try rephrasing.",
      parsedQuery: null,
      results: null,
      clarification: true,
    });
  } catch (err) {
    console.error("[/chat] error:", err);
    return res.status(500).json({
      assistantText: "Backend error while processing your request. Check server logs.",
      parsedQuery: null,
      results: null,
      clarification: true,
    });
  }
});

app.listen(3001, () => {
  console.log("Backend running on http://localhost:3001");
});
