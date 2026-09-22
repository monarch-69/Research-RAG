import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { streamAskQuestion } from "../api";
import type { Paper, Source, Turn } from "../types";

interface Props {
  papers: Paper[];
  initialFocusId?: string;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Indexing",
  done: "Ready",
  failed: "Failed",
};

export default function AskPanel({ papers, initialFocusId }: Props) {
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    if (!initialFocusId) return new Set<string>();
    return new Set(
      papers
        .filter((p) => p.status === "done" && p.paper_id !== initialFocusId)
        .map((p) => p.paper_id),
    );
  });
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const donePapers = papers.filter((p) => p.status === "done");
  const selectedIds = donePapers
    .map((p) => p.paper_id)
    .filter((id) => !excluded.has(id));
  const canAsk = selectedIds.length > 0 && !busy;

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  function grow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  async function handleSend() {
    const q = question.trim();
    if (!q || !canAsk) return;

    const id = crypto.randomUUID();
    setTurns((prev) => [
      ...prev,
      { id, question: q, answer: null, sources: [], error: null },
    ]);
    setQuestion("");
    const ta = textareaRef.current;
    if (ta) ta.style.height = "auto";
    setBusy(true);

    // Client-side safety net: abort if the server sends nothing for 90 s.
    // The server has its own 60 s per-chunk LLM timeout, so this only fires
    // if the server itself hangs (e.g. process frozen or network drop).
    const abort = new AbortController();
    const tid = window.setTimeout(() => abort.abort(), 90_000);

    try {
      await streamAskQuestion(
        q,
        selectedIds,
        // onToken: append each chunk — null→"" transition shows the bubble
        (token) => {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id ? { ...t, answer: (t.answer ?? "") + token } : t
            )
          );
        },
        // onDone: sources arrive after the last token
        (sources) => {
          setTurns((prev) =>
            prev.map((t) => (t.id === id ? { ...t, sources } : t))
          );
        },
        // onError: stream-level error sent by server before done
        (message) => {
          setTurns((prev) =>
            prev.map((t) => (t.id === id ? { ...t, error: message } : t))
          );
        },
        abort.signal,
      );
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const msg = isAbort
        ? "Request timed out. Please try again."
        : err instanceof Error
        ? err.message
        : "Something went wrong.";
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, error: msg } : t))
      );
    } finally {
      window.clearTimeout(tid);
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSend();
  }

  const inputPlaceholder =
    donePapers.length === 0
      ? "Waiting for papers to finish indexing…"
      : selectedIds.length === 0
      ? "Select a paper from the left panel first…"
      : "Ask a question… (Enter to send)";

  return (
    <section className="chat-section" id="ask">
      {/* ── Sidebar: all papers ── */}
      <aside className="paper-sidebar">
        <div className="sidebar-header">
          <span className="sidebar-label">Library</span>
          {donePapers.length > 0 && (
            <span className="sidebar-tally">
              {selectedIds.length}&thinsp;/&thinsp;{donePapers.length} active
            </span>
          )}
        </div>

        {papers.length === 0 ? (
          <p className="sidebar-empty">No papers yet — add one above.</p>
        ) : (
          <ul className="sidebar-papers" aria-label="Indexed papers">
            {papers.map((p) => {
              const isDone = p.status === "done";
              const on = isDone && !excluded.has(p.paper_id);
              return (
                <li
                  key={p.paper_id}
                  className={`sp${isDone ? " sp-done" : " sp-muted"}${on ? " sp-on" : ""}`}
                  role={isDone ? "checkbox" : "listitem"}
                  aria-checked={isDone ? on : undefined}
                  tabIndex={isDone ? 0 : -1}
                  onClick={() => isDone && toggle(p.paper_id)}
                  onKeyDown={(e) => {
                    if (isDone && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      toggle(p.paper_id);
                    }
                  }}
                >
                  <div className="sp-meta-row">
                    {isDone && (
                      <span className="sp-check" aria-hidden="true">
                        {on ? (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.5" />
                            <path
                              d="M4 7l2.2 2.2L10 4.8"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        )}
                      </span>
                    )}
                    <span className={`badge ${p.status}`}>
                      {(p.status === "queued" || p.status === "processing") && (
                        <span className="pulse" aria-hidden="true" />
                      )}
                      {p.status === "done" && p.chunks != null
                        ? `${p.chunks} passages`
                        : STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  <p className="sp-title">{p.paper_title}</p>
                  {p.paper_authors && <p className="sp-authors">{p.paper_authors}</p>}
                  {p.paper_summary && <p className="sp-summary">{p.paper_summary}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* ── Chat pane ── */}
      <div className="chat-pane">
        <div className="chat-pane-header">
          <h2 className="chat-heading">Ask your library</h2>
          <p className="chat-sub">
            {donePapers.length === 0
              ? "Waiting for papers to finish indexing…"
              : selectedIds.length === 0
              ? "Select at least one paper from the left panel"
              : `Searching across ${selectedIds.length} paper${selectedIds.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="chat-messages-wrap">
          {turns.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-glyph" aria-hidden="true">
                <svg
                  width="42"
                  height="42"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="chat-empty-title">No questions yet</p>
              <p className="chat-empty-body">
                {canAsk
                  ? "Ask anything about your indexed papers."
                  : "Index a paper to get started."}
              </p>
            </div>
          ) : (
            <div className="chat-turns">
              {turns.map((turn) => (
                <div key={turn.id} className="chat-turn">
                  {/* User question */}
                  <div className="chat-user-row">
                    <div className="chat-user-bubble">
                      <p>{turn.question}</p>
                    </div>
                  </div>

                  {/* AI response */}
                  <div className="chat-ai-row">
                    <div className="chat-avatar" aria-hidden="true">
                      S
                    </div>
                    <div className="chat-ai-body">
                      {turn.error ? (
                        <div className="chat-ai-bubble chat-ai-err">
                          <p>{turn.error}</p>
                        </div>
                      ) : turn.answer === null ? (
                        <div className="chat-typing" aria-label="Generating answer">
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : (
                        <div className="chat-ai-bubble">
                          <p className={`chat-ai-text${busy && turn.id === turns[turns.length - 1]?.id ? " streaming" : ""}`}>{turn.answer}</p>
                          {turn.sources.length > 0 && (
                            <div className="chat-sources">
                              <p className="chat-sources-label">
                                {turn.sources.length} passage
                                {turn.sources.length === 1 ? "" : "s"} referenced
                              </p>
                              <div className="chat-source-list">
                                {turn.sources.map((s: Source, i: number) => (
                                  <div key={`${s.paper_id}-${i}`} className="chat-source-card">
                                    <p className="csc-paper">
                                      {s.paper_name}
                                      {s.section && (
                                        <span className="csc-section"> · {s.section}</span>
                                      )}
                                    </p>
                                    <p className="csc-excerpt">{s.excerpt}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div ref={bottomRef} aria-hidden="true" />
        </div>

        {/* Sticky input */}
        <div className="chat-input-area">
          <form className="chat-form" onSubmit={onSubmit}>
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              rows={1}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                grow();
              }}
              onKeyDown={onKey}
              placeholder={inputPlaceholder}
              disabled={!canAsk && !busy}
              aria-label="Your question"
            />
            <button
              type="submit"
              className="chat-send"
              disabled={!question.trim() || !canAsk}
              aria-label="Send question"
            >
              {busy ? (
                <span className="chat-spin" aria-hidden="true" />
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </form>
          <p className="chat-hint">Enter to send · Shift ↵ for new line</p>
        </div>
      </div>
    </section>
  );
}
