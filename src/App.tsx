import { useMemo, useState } from "react";
import "./App.css";
import {
  getLinkedVehiclesForPerson,
  getLinkedCasesForPerson,
  getLinkedFIsForPerson,
  getTripsForPerson,
  getEntityById,
} from "./query";

type Msg = { role: "user" | "assistant"; text: string };

type Selected =
  | { type: "person" | "vehicle" | "case" | "fi" | "trip" | "document"; id: string }
  | null;

function Pill({ children }: { children: any }) {
  return <span className="pill">{children}</span>;
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="sectionTitle">
      <div>{title}</div>
      <div className="countBadge">{count}</div>
    </div>
  );
}

// Prefer env var for Netlify, fallback to your Render URL
const API_BASE =
  (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, "") ||
  "https://customs-chatbot-1.onrender.com";

const CHAT_URL = `${API_BASE}/chat`;

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text:
        `Try examples:\n` +
        `- tan\n` +
        `- nationality:malaysian gender:male\n` +
        `- dob:1984-09-02\n` +
        `- passport:A12345678\n` +
        `- address:"johor bahru"\n` +
        `- vehicle:JTY 223\n` +
        `- status:"under investigation"\n` +
        `- received_date:2025-12\n` +
        `\nDocs:\n` +
        `- P-0006\n` +
        `- SC-TOB-2025-00112\n` +
        `- FI-2025-0719`,
    },
  ]);

  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<Selected>(null);

  const [results, setResults] = useState<any>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || isLoading) return;

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setSelected(null);
    setIsLoading(true);

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const payload = await res.json();

      const assistantMsg: string = payload?.assistantText ?? "Search completed.";

      // Always show assistant response
      setMessages((m) => [...m, { role: "assistant", text: assistantMsg }]);

      // If backend wants clarification, don't overwrite results
      if (payload?.clarification) return;

      setResults(payload?.results ?? null);
      setQuery(payload?.parsedQuery ?? text);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `Error contacting backend. Is Render up? (${API_BASE})`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  // Pull detail from *current results* first (so documents work),
  // fallback to local JSON getters for the old types.
  const detail = useMemo(() => {
    if (!selected) return null;

    if (selected.type === "document") {
      const docs = results?.documents ?? [];
      return docs.find((d: any) => d.doc_id === selected.id) ?? null;
    }

    // try results pool first
    const pool =
      selected.type === "person"
        ? results?.persons
        : selected.type === "vehicle"
        ? results?.vehicles
        : selected.type === "case"
        ? results?.cases
        : selected.type === "fi"
        ? results?.first_info_reports
        : results?.trips;

    const key =
      selected.type === "person"
        ? "person_id"
        : selected.type === "vehicle"
        ? "vehicle_id"
        : selected.type === "case"
        ? "case_id"
        : selected.type === "fi"
        ? "first_info_id"
        : "trip_id";

    const fromResults = Array.isArray(pool)
      ? pool.find((x: any) => x?.[key] === selected.id)
      : null;

    if (fromResults) return fromResults;

    // fallback to local in-memory helpers
    return getEntityById(selected.type as any, selected.id);
  }, [selected, results]);

  const personGraph = useMemo(() => {
    if (!selected || selected.type !== "person") return null;
    const p = getEntityById("person", selected.id);
    if (!p) return null;
    return {
      vehicles: getLinkedVehiclesForPerson(p.person_id),
      cases: getLinkedCasesForPerson(p.person_id),
      first_info_reports: getLinkedFIsForPerson(p.person_id),
      trips: getTripsForPerson(p.person_id),
    };
  }, [selected]);

  const placeholderCaseFileUrl = "https://example.com/case-file";
  const placeholderImage =
    "https://via.placeholder.com/960x540.png?text=Evidence+Snapshot";

  const docs = results?.documents ?? [];

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-dot" />
          Customs Search Copilot
        </div>
        <div className="topbarHint">Demo • JSON + Documents • Backend on Render</div>
      </div>

      <div className="main">
        {/* Chat */}
        <div className="chat">
          <div className="chat-header">
            Conversation
            <div style={{ fontSize: 12, opacity: 0.65 }}>Search: all fields + filters</div>
          </div>

          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.text.split("\n").map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </div>
            ))}
          </div>

          <div className="chat-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Try: nationality:malaysian gender:male address:"johor bahru"'
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={isLoading}
            />
            <button onClick={send} disabled={isLoading}>
              {isLoading ? "Searching..." : "Search"}
            </button>
          </div>

          <div style={{ fontSize: 12, opacity: 0.6, padding: "10px 14px" }}>
            API: <span style={{ opacity: 0.9 }}>{API_BASE}</span>
          </div>
        </div>

        {/* Workspace */}
        <div className="workspace">
          <div className="card">
            <div className="card-title">Search Results</div>
            <div className="card-sub">
              Persons • Vehicles • Intel • Cases • Trips • Documents
            </div>

            {query && (
              <div className="queryBar">
                <Pill>query</Pill>
                <div className="queryText">{query}</div>
              </div>
            )}
          </div>

          {!results ? (
            <div className="card">
              <div className="card-title">No query yet</div>
              <div className="card-sub">Type a query on the left and hit Search.</div>
            </div>
          ) : (
            <div className="grid2">
              {/* Persons */}
              <div className="card">
                <SectionTitle title="Persons" count={results.persons.length} />
                <div className="list">
                  {results.persons.slice(0, 12).map((p: any) => (
                    <button
                      key={p.person_id}
                      className="item"
                      onClick={() => setSelected({ type: "person", id: p.person_id })}
                    >
                      <div className="itemMain">
                        <div className="itemTitle">{p.name?.primary_name}</div>
                        <div className="itemSub">
                          <Pill>{p.person_id}</Pill> <Pill>{p.gender}</Pill>{" "}
                          <Pill>{p.nationality}</Pill> <Pill>{p.date_of_birth}</Pill>
                        </div>
                      </div>
                      <div className="chev">›</div>
                    </button>
                  ))}
                  {results.persons.length > 12 && (
                    <div className="moreHint">Showing 12 of {results.persons.length}</div>
                  )}
                </div>
              </div>

              {/* Vehicles */}
              <div className="card">
                <SectionTitle title="Vehicles" count={results.vehicles.length} />
                <div className="list">
                  {results.vehicles.slice(0, 12).map((v: any) => (
                    <button
                      key={v.vehicle_id}
                      className="item"
                      onClick={() => setSelected({ type: "vehicle", id: v.vehicle_id })}
                    >
                      <div className="itemMain">
                        <div className="itemTitle">{v.vehicle_number}</div>
                        <div className="itemSub">
                          <Pill>{v.vehicle_id}</Pill> <Pill>{v.vehicle_type}</Pill>{" "}
                          <Pill>{v.colour}</Pill>
                        </div>
                      </div>
                      <div className="chev">›</div>
                    </button>
                  ))}
                  {results.vehicles.length > 12 && (
                    <div className="moreHint">Showing 12 of {results.vehicles.length}</div>
                  )}
                </div>
              </div>

              {/* Cases */}
              <div className="card">
                <SectionTitle title="Cases" count={results.cases.length} />
                <div className="list">
                  {results.cases.slice(0, 10).map((c: any) => (
                    <button
                      key={c.case_id}
                      className="item"
                      onClick={() => setSelected({ type: "case", id: c.case_id })}
                    >
                      <div className="itemMain">
                        <div className="itemTitle">{c.case_id}</div>
                        <div className="itemSub">
                          <Pill>{c.case_type}</Pill> <Pill>{c.status}</Pill>{" "}
                          <Pill>opened {c.opened_date}</Pill>
                        </div>
                      </div>
                      <div className="chev">›</div>
                    </button>
                  ))}
                  {results.cases.length > 10 && (
                    <div className="moreHint">Showing 10 of {results.cases.length}</div>
                  )}
                </div>
              </div>

              {/* Intel + Trips */}
              <div className="card">
                <SectionTitle
                  title="Intel + Trips"
                  count={results.first_info_reports.length + results.trips.length}
                />
                <div className="list">
                  {results.first_info_reports.slice(0, 6).map((fi: any) => (
                    <button
                      key={fi.first_info_id}
                      className="item"
                      onClick={() => setSelected({ type: "fi", id: fi.first_info_id })}
                    >
                      <div className="itemMain">
                        <div className="itemTitle">{fi.first_info_id}</div>
                        <div className="itemSub">
                          <Pill>{fi.source}</Pill> <Pill>{fi.confidence_level}</Pill>{" "}
                          <Pill>{fi.received_date}</Pill>
                        </div>
                      </div>
                      <div className="chev">›</div>
                    </button>
                  ))}

                  {results.trips.slice(0, 6).map((t: any) => (
                    <button
                      key={t.trip_id}
                      className="item"
                      onClick={() => setSelected({ type: "trip", id: t.trip_id })}
                    >
                      <div className="itemMain">
                        <div className="itemTitle">{t.trip_id}</div>
                        <div className="itemSub">
                          <Pill>{t.entry_point}</Pill> <Pill>{t.destination}</Pill>{" "}
                          <Pill>{t.travel_pattern_flag ?? "n/a"}</Pill>
                        </div>
                      </div>
                      <div className="chev">›</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Documents */}
              <div className="card">
                <SectionTitle title="Documents" count={docs.length} />
                <div className="list">
                  {docs.slice(0, 12).map((d: any) => (
                    <button
                      key={d.doc_id}
                      className="item"
                      onClick={() => setSelected({ type: "document", id: d.doc_id })}
                    >
                      <div className="itemMain">
                        <div className="itemTitle">{d.title ?? d.filename ?? d.doc_id}</div>
                        <div className="itemSub">
                          {d.doc_type && <Pill>{d.doc_type}</Pill>}{" "}
                          {d.case_id && <Pill>{d.case_id}</Pill>}{" "}
                          {d.person_id && <Pill>{d.person_id}</Pill>}
                        </div>

                        {d.snippet && (
                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75, lineHeight: 1.35 }}>
                            {d.snippet}
                          </div>
                        )}
                      </div>
                      <div className="chev">›</div>
                    </button>
                  ))}

                  {docs.length > 12 && (
                    <div className="moreHint">Showing 12 of {docs.length}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Drawer */}
          {selected && detail && (
            <div className="drawerOverlay" onClick={() => setSelected(null)}>
              <div className="drawer" onClick={(e) => e.stopPropagation()}>
                <div className="drawerHeader">
                  <div className="drawerTitle">
                    {selected.type.toUpperCase()} •{" "}
                    {selected.type === "person"
                      ? detail.name?.primary_name
                      : selected.type === "vehicle"
                      ? detail.vehicle_number
                      : selected.type === "case"
                      ? detail.case_id
                      : selected.type === "fi"
                      ? detail.first_info_id
                      : selected.type === "trip"
                      ? detail.trip_id
                      : detail.title ?? detail.filename ?? detail.doc_id}
                  </div>
                  <button className="drawerClose" onClick={() => setSelected(null)}>
                    ✕
                  </button>
                </div>

                <div className="drawerBody">
                  <div className="drawerActions">
                    {/* Documents get a real link */}
                    {selected.type === "document" && detail.doc_url ? (
                      <a className="primaryLink" href={detail.doc_url} target="_blank" rel="noreferrer">
                        Open document (PDF)
                      </a>
                    ) : (
                      <a className="primaryLink" href={placeholderCaseFileUrl} target="_blank" rel="noreferrer">
                        Open case file
                      </a>
                    )}

                    <a className="ghostLink" href={placeholderImage} target="_blank" rel="noreferrer">
                      Evidence snapshot
                    </a>
                  </div>

                  {/* snippet preview for docs */}
                  {selected.type === "document" && detail.snippet && (
                    <div className="card" style={{ marginBottom: 12 }}>
                      <div className="card-title">Snippet</div>
                      <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.85 }}>
                        {detail.snippet}
                      </div>
                    </div>
                  )}

                  <div className="kvGrid">
                    {Object.entries(detail).slice(0, 18).map(([k, v]) => (
                      <div key={k} className="kv">
                        <div className="kvKey">{k}</div>
                        <div className="kvVal">{typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
                      </div>
                    ))}
                  </div>

                  {/* If person selected: show linked records */}
                  {selected.type === "person" && personGraph && (
                    <div className="subSection">
                      <div className="subSectionTitle">Linked records</div>

                      <div className="miniGrid">
                        <div className="miniCard">
                          <div className="miniTitle">Vehicles</div>
                          <div className="miniCount">{personGraph.vehicles.length}</div>
                        </div>
                        <div className="miniCard">
                          <div className="miniTitle">Cases</div>
                          <div className="miniCount">{personGraph.cases.length}</div>
                        </div>
                        <div className="miniCard">
                          <div className="miniTitle">Intel</div>
                          <div className="miniCount">{personGraph.first_info_reports.length}</div>
                        </div>
                        <div className="miniCard">
                          <div className="miniTitle">Trips</div>
                          <div className="miniCount">{personGraph.trips.length}</div>
                        </div>
                      </div>

                      <div className="linkedList">
                        {personGraph.cases.slice(0, 5).map((c: any) => (
                          <button
                            key={c.case_id}
                            className="linkedItem"
                            onClick={() => setSelected({ type: "case", id: c.case_id })}
                          >
                            <div className="linkedTitle">{c.case_id}</div>
                            <div className="linkedSub">
                              <Pill>{c.case_type}</Pill> <Pill>{c.status}</Pill>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
