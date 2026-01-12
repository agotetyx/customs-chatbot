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
  | { type: "person" | "vehicle" | "case" | "fi" | "trip"; id: string }
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

const BACKEND_CHAT_URL = "https://customs-chatbot-1.onrender.com/chat";

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
        `- received_date:2025-12`,
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
      const res = await fetch(BACKEND_CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const payload = await res.json();

      const assistantMsg: string =
        payload?.assistantText ?? "Search completed.";

      // Always show the assistant response (even for clarification)
      setMessages((m) => [...m, { role: "assistant", text: assistantMsg }]);

      // If backend wants clarification, do NOT overwrite results/query.
      if (payload?.clarification) {
        setIsLoading(false);
        return;
      }

      setResults(payload?.results ?? null);
      setQuery(payload?.parsedQuery ?? text);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            "Error contacting backend. Check the Render service is live and try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  const detail = useMemo(() => {
    if (!selected) return null;
    return getEntityById(selected.type, selected.id);
  }, [selected]);

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
    "https://via.placeholder.com/960x540.png?text=Case+File+Placeholder";

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-dot" />
          Customs Search Copilot
        </div>
        <div className="topbarHint">
          In-memory demo • Tool-ready for Bedrock later
        </div>
      </div>

      <div className="main">
        {/* Chat */}
        <div className="chat">
          <div className="chat-header">
            Conversation
            <div style={{ fontSize: 12, opacity: 0.65 }}>
              Search: all fields + filters
            </div>
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
        </div>

        {/* Workspace */}
        <div className="workspace">
          <div className="card">
            <div className="card-title">Search Results</div>
            <div className="card-sub">
              Querying across persons, vehicles, first info reports, cases, and
              trips.
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
                      onClick={() =>
                        setSelected({ type: "person", id: p.person_id })
                      }
                    >
                      <div className="itemMain">
                        <div className="itemTitle">{p.name?.primary_name}</div>
                        <div className="itemSub">
                          <Pill>{p.person_id}</Pill> <Pill>{p.gender}</Pill>{" "}
                          <Pill>{p.nationality}</Pill>{" "}
                          <Pill>{p.date_of_birth}</Pill>
                        </div>
                      </div>
                      <div className="chev">›</div>
                    </button>
                  ))}
                  {results.persons.length > 12 && (
                    <div className="moreHint">
                      Showing 12 of {results.persons.length}
                    </div>
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
                      onClick={() =>
                        setSelected({ type: "vehicle", id: v.vehicle_id })
                      }
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
                    <div className="moreHint">
                      Showing 12 of {results.vehicles.length}
                    </div>
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
                    <div className="moreHint">
                      Showing 10 of {results.cases.length}
                    </div>
                  )}
                </div>
              </div>

              {/* FI + Trips */}
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
                      : detail.trip_id}
                  </div>
                  <button className="drawerClose" onClick={() => setSelected(null)}>
                    ✕
                  </button>
                </div>

                <div className="drawerBody">
                  <div className="drawerActions">
                    <a
                      className="primaryLink"
                      href={placeholderCaseFileUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open case file
                    </a>
                    <a className="ghostLink" href={placeholderImage} target="_blank" rel="noreferrer">
                      Evidence snapshot
                    </a>
                  </div>

                  <div className="kvGrid">
                    {Object.entries(detail).slice(0, 14).map(([k, v]) => (
                      <div key={k} className="kv">
                        <div className="kvKey">{k}</div>
                        <div className="kvVal">
                          {typeof v === "object" ? JSON.stringify(v) : String(v)}
                        </div>
                      </div>
                    ))}
                  </div>

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
