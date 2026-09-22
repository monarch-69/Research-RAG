import { useCallback, useState } from "react";
import AskPanel from "./components/AskPanel";
import IndexForm from "./components/IndexForm";
import Library from "./components/Library";
import PapersIndexed from "./components/PapersIndexed";
import { useIndexPolling } from "./hooks/useIndexPolling";
import type { PaperPatch } from "./hooks/useIndexPolling";
import type { Paper } from "./types";
import "./styles.css";

type View = "home" | "ask";

const STEPS = [
  {
    title: "Receive",
    body: "The file is accepted straight away and queued, so you can keep working.",
  },
  {
    title: "Extract and split",
    body: "The text layer is read in order and cut into overlapping passages.",
  },
  {
    title: "Preserve the title page",
    body: "Titles, authors and affiliations stay together as one labelled passage.",
  },
  {
    title: "Index",
    body: "Each passage is embedded and stored, tagged with the paper it came from.",
  },
];

export default function App() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [view, setView] = useState<View>("home");
  const [askFocusId, setAskFocusId] = useState<string | undefined>();

  const updatePaper = useCallback((paperId: string, patch: PaperPatch) => {
    setPapers((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        if (p.paper_id !== paperId) return p;
        const merged = { ...p, ...patch };
        if (
          merged.status === p.status &&
          merged.chunks === p.chunks &&
          merged.error === p.error
        ) {
          return p;
        }
        changed = true;
        return merged;
      });
      return changed ? next : prev;
    });
  }, []);

  useIndexPolling(papers, updatePaper);

  function onAccepted(paper: Paper) {
    setPapers((prev) => [paper, ...prev]);
  }

  function onDismiss(paperId: string) {
    setPapers((prev) => prev.filter((p) => p.paper_id !== paperId));
  }

  function openAsk(paperId?: string) {
    setAskFocusId(paperId);
    setView("ask");
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }

  function goHome() {
    setView("home");
    setAskFocusId(undefined);
  }

  const donePapers = papers.filter((p) => p.status === "done");

  /* ── Ask page ── */
  if (view === "ask") {
    return (
      <div className="ask-page">
        <header className="ask-page-header">
          <div className="aph-left">
            <button className="aph-back" onClick={goHome} type="button">
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M13 8H3M7 12l-4-4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Papers
            </button>
            <span className="aph-sep" aria-hidden="true" />
            <span className="aph-title">Ask your library</span>
          </div>
          {donePapers.length > 0 && (
            <span className="aph-count">
              {donePapers.length} paper{donePapers.length === 1 ? "" : "s"}{" "}
              indexed
            </span>
          )}
        </header>

        <div className="ask-page-body">
          <AskPanel papers={papers} initialFocusId={askFocusId} />
        </div>
      </div>
    );
  }

  /* ── Home page ── */
  return (
    <div className="home-page">
      <nav>
        <a className="brand" href="#add">
          <span className="mark" />
          Scholar
        </a>
        <div className="nav-links">
          <a href="#add">Add a paper</a>
          {donePapers.length > 0 && <a href="#papers">Papers</a>}
          {donePapers.length > 0 && (
            <button
              className="nav-ask-btn"
              type="button"
              onClick={() => openAsk()}
            >
              Ask
            </button>
          )}
          <a href="#how">How it works</a>
        </div>
      </nav>

      <div className="wrap">
        <section className="hero" id="add">
          <div>
            <h1>
              Your papers, finally <em>answerable</em>.
            </h1>
            <p className="lede">
              Add a PDF and Scholar reads it end to end — splitting it into
              passages, indexing every one, and keeping the title page intact so
              questions about authorship actually land.
            </p>
            <div className="facts">
              <div className="fact">
                <b>PDF</b>
                <span>Text-layer PDFs up to 10 MB</span>
              </div>
              <div className="fact">
                <b>Grounded</b>
                <span>Answers drawn only from the papers you add</span>
              </div>
              <div className="fact">
                <b>Cited</b>
                <span>Every answer points back to its source passage</span>
              </div>
            </div>

            <Library papers={papers} onDismiss={onDismiss} />

            {donePapers.length > 0 && (
              <div className="hero-ask-row">
                <button
                  className="hero-ask-cta"
                  type="button"
                  onClick={() => openAsk()}
                >
                  Start asking questions
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
                <span className="hero-ask-note">
                  {donePapers.length} paper{donePapers.length === 1 ? "" : "s"}{" "}
                  ready
                </span>
              </div>
            )}
          </div>

          <IndexForm onAccepted={onAccepted} />
        </section>
      </div>

      {donePapers.length > 0 && (
        <PapersIndexed
          papers={donePapers}
          onAskAll={() => openAsk()}
          onAskPaper={(id) => openAsk(id)}
        />
      )}

      <section className="pipeline" id="how">
        <div className="wrap">
          <h2>What happens after you upload</h2>
          <p>
            Indexing runs in the background, so a long paper never locks the
            page. The third step is the one that matters most — it's why asking
            who wrote a paper returns the authors instead of the abstract.
          </p>
          <div className="steps">
            {STEPS.map((step, i) => (
              <div className="step" key={step.title}>
                <div className="n">{i + 1}</div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer>
        <span>Scholar</span>
        <span>Answers are only as good as the papers behind them.</span>
      </footer>
    </div>
  );
}
