import type { Paper } from "../types";

interface Props {
  papers: Paper[]; // only done papers
  onOpen: (paper: Paper) => void;
}

export default function ExplorePapers({ papers, onOpen }: Props) {
  if (papers.length === 0) return null;

  return (
    <section className="explore-section" id="explore">
      <div className="wrap">
        <div className="explore-header">
          <div>
            <h2 className="explore-heading">Explore papers</h2>
            <p className="explore-lede">
              Click a paper to open a focused conversation about it.
            </p>
          </div>
          <span className="explore-tally" aria-label={`${papers.length} papers`}>
            {papers.length} paper{papers.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="explore-grid">
          {papers.map((p) => (
            <button
              key={p.paper_id}
              className="explore-card"
              type="button"
              onClick={() => onOpen(p)}
            >
              <div className="ec-top">
                {p.chunks != null && (
                  <span className="ec-passages">{p.chunks} passages</span>
                )}
              </div>

              <h3 className="ec-title">{p.paper_title}</h3>

              {p.paper_authors && (
                <p className="ec-authors">{p.paper_authors}</p>
              )}

              {p.paper_summary && (
                <p className="ec-summary">{p.paper_summary}</p>
              )}

              <div className="ec-cta">
                <span>Ask about this paper</span>
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
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
