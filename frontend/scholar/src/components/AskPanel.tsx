import { useState } from "react";
import type { FormEvent } from "react";
import { askQuestion } from "../api";
import type { Paper, Turn } from "../types";

interface Props {
  /** Only papers that have finished indexing. */
  papers: Paper[];
}

export default function AskPanel({ papers }: Props) {
  // Track what the user turned *off*, not what's on. That way a paper
  // that finishes indexing later is included automatically.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const selectedIds = papers
    .map((p) => p.paper_id)
    .filter((id) => !excluded.has(id));

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy || selectedIds.length === 0) return;

    const id = crypto.randomUUID();
    setTurns((prev) => [
      { id, question: q, answer: null, sources: [], error: null },
      ...prev,
    ]);
    setQuestion("");
    setBusy(true);

    try {
      const res = await askQuestion(q, selectedIds);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, answer: res.answer, sources: res.sources } : t,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, error: message } : t)),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ask" id="ask">
      <div className="wrap">
        <h2>Ask your library</h2>
        <p className="ask-lede">
          Answers come only from passages retrieved from your papers. If they
          don't cover something, you'll be told so rather than guessed at.
        </p>

        {papers.length > 1 && (
          <div className="picker">
            {papers.map((p) => {
              const on = !excluded.has(p.paper_id);
              return (
                <button
                  key={p.paper_id}
                  type="button"
                  className={`chip${on ? " on" : ""}`}
                  onClick={() => toggle(p.paper_id)}
                  aria-pressed={on}
                >
                  {p.paper_title}
                </button>
              );
            })}
          </div>
        )}

        <form className="askbar" onSubmit={onSubmit}>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Who are the authors of this paper?"
            aria-label="Your question"
          />
          <button type="submit" disabled={busy || selectedIds.length === 0}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </form>

        {selectedIds.length === 0 && (
          <p className="hint">Select at least one paper to search.</p>
        )}

        <div className="transcript">
          {turns.map((turn) => (
            <article key={turn.id} className="turn">
              <h3 className="q">{turn.question}</h3>

              {turn.error ? (
                <p className="a err-text">{turn.error}</p>
              ) : turn.answer === null ? (
                <p className="a pending">Searching the passages…</p>
              ) : (
                <>
                  <p className="a">{turn.answer}</p>
                  {turn.sources.length > 0 && (
                    <details className="sources">
                      <summary>
                        {turn.sources.length} passage
                        {turn.sources.length === 1 ? "" : "s"} used
                      </summary>
                      {turn.sources.map((s, i) => (
                        <blockquote key={`${s.paper_id}-${i}`}>
                          <cite>
                            {s.paper_name}
                            {s.section ? ` — ${s.section}` : ""}
                          </cite>
                          <p>{s.excerpt}</p>
                        </blockquote>
                      ))}
                    </details>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
