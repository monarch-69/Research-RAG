import { isTerminal } from "../types";
import type { IndexStatus, Paper } from "../types";

interface Props {
  papers: Paper[];
  onDismiss: (paperId: string) => void;
}

const LABEL: Record<IndexStatus, string> = {
  queued: "Queued",
  processing: "Indexing",
  done: "Ready",
  failed: "Failed",
};

export default function Library({ papers, onDismiss }: Props) {
  if (papers.length === 0) return null;

  const pending = papers.filter((p) => !isTerminal(p.status)).length;

  return (
    <div className="library">
      <div className="library-head">
        <h3>Your papers</h3>
        {pending > 0 && (
          <span className="library-note">
            {pending} indexing
          </span>
        )}
      </div>

      <ul aria-live="polite">
        {papers.map((p) => (
          <li key={p.paper_id} className="paper">
            <div className="paper-row">
              <span className="paper-title" title={p.paper_title}>
                {p.paper_title}
              </span>
              <span className={`badge ${p.status}`}>
                {!isTerminal(p.status) && <span className="pulse" aria-hidden="true" />}
                {p.status === "done" && p.chunks != null
                  ? `${p.chunks} passages`
                  : LABEL[p.status]}
              </span>
            </div>

            {p.status === "failed" && (
              <div className="paper-error">
                <span>{p.error ?? "Indexing failed."}</span>
                <button type="button" onClick={() => onDismiss(p.paper_id)}>
                  Dismiss
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
