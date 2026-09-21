import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as RKeyboardEvent } from "react";
import { askQuestion } from "../api";
import type { Paper, Source, Turn } from "../types";

interface Props {
  paper: Paper;
  onClose: () => void;
}

export default function PaperModal({ paper, onClose }: Props) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus close button and lock body scroll on mount
  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  function grow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function onKey(e: RKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  async function handleSend() {
    const q = question.trim();
    if (!q || busy) return;

    const id = crypto.randomUUID();
    setTurns((prev) => [
      ...prev,
      { id, question: q, answer: null, sources: [], error: null },
    ]);
    setQuestion("");
    const ta = textareaRef.current;
    if (ta) ta.style.height = "auto";
    setBusy(true);

    try {
      const res = await askQuestion(q, [paper.paper_id]);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, answer: res.answer, sources: res.sources } : t
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, error: msg } : t))
      );
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSend();
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="paper-modal"
        role="dialog"
        aria-modal="true"
        aria-label={paper.paper_title}
      >
        {/* ── Left: paper identity ── */}
        <aside className="modal-info">
          <button
            ref={closeRef}
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="modal-info-body">
            <div className="mi-dot" aria-hidden="true" />

            {paper.chunks != null && (
              <span className="badge done mi-badge">
                {paper.chunks} passages
              </span>
            )}

            <h2 className="mi-title">{paper.paper_title}</h2>

            {paper.paper_authors && (
              <p className="mi-authors">{paper.paper_authors}</p>
            )}

            {paper.paper_summary && (
              <p className="mi-summary">{paper.paper_summary}</p>
            )}
          </div>
        </aside>

        {/* ── Right: focused chat ── */}
        <div className="modal-chat">
          <div className="modal-chat-header">
            <span className="modal-chat-eyebrow">Focused on</span>
            <p className="modal-chat-paper-name">{paper.paper_title}</p>
          </div>

          <div className="modal-messages">
            {turns.length === 0 ? (
              <div className="chat-empty">
                <div className="chat-empty-glyph" aria-hidden="true">
                  <svg
                    width="40"
                    height="40"
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
                  Ask anything about{" "}
                  <em className="modal-em">{paper.paper_title}</em>.
                </p>
              </div>
            ) : (
              <div className="chat-turns">
                {turns.map((turn) => (
                  <div key={turn.id} className="chat-turn">
                    <div className="chat-user-row">
                      <div className="chat-user-bubble">
                        <p>{turn.question}</p>
                      </div>
                    </div>

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
                          <div
                            className="chat-typing"
                            aria-label="Generating answer"
                          >
                            <span />
                            <span />
                            <span />
                          </div>
                        ) : (
                          <div className="chat-ai-bubble">
                            <p className="chat-ai-text">{turn.answer}</p>
                            {turn.sources.length > 0 && (
                              <div className="chat-sources">
                                <p className="chat-sources-label">
                                  {turn.sources.length} passage
                                  {turn.sources.length === 1 ? "" : "s"}{" "}
                                  referenced
                                </p>
                                <div className="chat-source-list">
                                  {turn.sources.map((s: Source, i: number) => (
                                    <div
                                      key={`${s.paper_id}-${i}`}
                                      className="chat-source-card"
                                    >
                                      <p className="csc-paper">
                                        {s.paper_name}
                                        {s.section && (
                                          <span className="csc-section">
                                            {" "}
                                            · {s.section}
                                          </span>
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
                placeholder="Ask a question about this paper…"
                disabled={busy}
                aria-label="Your question"
              />
              <button
                type="submit"
                className="chat-send"
                disabled={!question.trim() || busy}
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
      </div>
    </div>
  );
}
