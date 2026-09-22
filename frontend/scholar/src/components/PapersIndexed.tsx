import type { Paper } from "../types";

interface Props {
  papers: Paper[]; // only done papers
  onAskAll: () => void;
  onAskPaper: (paperId: string) => void;
}

export default function PapersIndexed({ papers, onAskAll, onAskPaper }: Props) {
  if (papers.length === 0) return null;

  return (
    <section className="pi-section" id="papers">
      <div className="wrap">
        <div className="pi-header">
          <div>
            <h2 className="pi-heading">Papers Indexed</h2>
            <p className="pi-lede">
              {papers.length} paper{papers.length === 1 ? "" : "s"} ready to
              interrogate. Pick one below or search across your entire library.
            </p>
          </div>

          <button className="pi-ask-all" onClick={onAskAll} type="button">
            Ask all papers
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="pi-grid">
          {papers.map((p) => (
            <article key={p.paper_id} className="pi-card">
              {p.chunks != null && (
                <span className="pi-passages">{p.chunks} passages</span>
              )}

              <h3 className="pi-title">{p.paper_title}</h3>

              {p.paper_authors && (
                <p className="pi-authors">{p.paper_authors}</p>
              )}

              {p.paper_summary && (
                <p className="pi-summary">{p.paper_summary}</p>
              )}

              <button
                className="pi-ask-btn"
                type="button"
                onClick={() => onAskPaper(p.paper_id)}
              >
                Ask about this paper
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
