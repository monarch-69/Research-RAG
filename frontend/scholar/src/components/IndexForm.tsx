import { useRef, useState } from "react";
import type { DragEvent, FormEvent, KeyboardEvent } from "react";
import { humanSize, indexPaper, MAX_BYTES } from "../api";
import type { IndexFormValues, Paper } from "../types";
import PdfGlyph from "./PdfGlyph";

interface Props {
  /** Called once the server has accepted the upload (HTTP 202). */
  onAccepted: (paper: Paper) => void;
}

const EMPTY: IndexFormValues = {
  paper_title: "",
  paper_authors: "",
  paper_summary: "",
};

export default function IndexForm({ onAccepted }: Props) {
  const [values, setValues] = useState<IndexFormValues>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [touchedTitle, setTouchedTitle] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const titleMissing = touchedTitle && !values.paper_title.trim();

  function update(field: keyof IndexFormValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function take(candidate: File | undefined) {
    if (!candidate || uploading) return;

    const isPdf =
      candidate.type === "application/pdf" ||
      candidate.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setError("That file isn't a PDF. Choose a .pdf and try again.");
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError(`That file is ${humanSize(candidate.size)}. The limit is 10 MB.`);
      return;
    }

    setFile(candidate);
    setError(null);
    setNotice(null);

    // Offer the filename as a starting title if the field is empty.
    if (!values.paper_title.trim()) {
      const guess = candidate.name
        .replace(/\.pdf$/i, "")
        .replace(/[_-]+/g, " ")
        .trim();
      update("paper_title", guess);
    }
  }

  function clearFile() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files[0]);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setTouchedTitle(true);

    const title = values.paper_title.trim();
    if (!title) {
      setError("Give the paper a title first.");
      return;
    }
    if (!file) {
      setError("Choose a PDF to index.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setPercent(0);

    try {
      const accepted = await indexPaper(
        { ...values, paper_title: title },
        file,
        setPercent,
        controller.signal,
      );

      onAccepted({
        paper_id: accepted.paper_id,
        paper_title: title,
        paper_authors: values.paper_authors.trim() || undefined,
        paper_summary: values.paper_summary.trim() || undefined,
        status: accepted.status ?? "queued",
        submitted_at: Date.now(),
      });

      setNotice(
        `“${title}” is indexing in the background. Add another paper while it works.`,
      );
      setValues(EMPTY);
      setTouchedTitle(false);
      clearFile();
    } catch (err) {
      // A cancel is the user's own choice; don't dress it up as an error.
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Couldn't upload that paper.");
      }
    } finally {
      abortRef.current = null;
      setUploading(false);
      setPercent(0);
    }
  }

  const sent = percent >= 100;

  return (
    <div className="card">
      <h2>Add a paper</h2>
      <p className="sub">A PDF with a text layer works best. Scanned pages won't index.</p>

      <form onSubmit={onSubmit} noValidate>
        {!file ? (
          <div
            className={`drop${dragging ? " over" : ""}`}
            tabIndex={0}
            role="button"
            aria-label="Choose a PDF file"
            onClick={() => inputRef.current?.click()}
            onKeyDown={onKey}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div className="drop-glyph">
              <PdfGlyph />
            </div>
            <div className="drop-main">
              {dragging ? "Release to add it" : "Drop a PDF here"}
            </div>
            <div className="drop-sub">
              or <span className="link">browse your files</span> · up to 10 MB
            </div>
          </div>
        ) : (
          <div className={`picked${uploading ? " busy" : ""}`}>
            <div className="picked-top">
              <span className="picked-glyph">
                <PdfGlyph />
              </span>
              <span className="picked-text">
                <span className="picked-name" title={file.name}>
                  {file.name}
                </span>
                <span className="picked-meta">
                  {humanSize(file.size)}
                  {uploading && !sent && ` · ${percent}% sent`}
                  {uploading && sent && " · waiting for the server"}
                </span>
              </span>

              {uploading ? (
                <button
                  type="button"
                  className="picked-cancel"
                  onClick={() => abortRef.current?.abort()}
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="picked-clear"
                  onClick={clearFile}
                  aria-label="Remove file"
                >
                  &times;
                </button>
              )}
            </div>

            {uploading && (
              <div
                className="bar"
                role="progressbar"
                aria-label="Upload progress"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="bar-fill" style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => take(e.target.files?.[0])}
        />

        <div className="field first">
          <label htmlFor="title">Paper title</label>
          <input
            id="title"
            type="text"
            className={titleMissing ? "invalid" : undefined}
            value={values.paper_title}
            disabled={uploading}
            onBlur={() => setTouchedTitle(true)}
            onChange={(e) => update("paper_title", e.target.value)}
            placeholder="AI Assistant For Disabled"
          />
          {titleMissing && <span className="field-error">A title is required.</span>}
        </div>

        <div className="field">
          <label htmlFor="authors">
            Authors <span className="opt">optional</span>
          </label>
          <input
            id="authors"
            type="text"
            value={values.paper_authors}
            disabled={uploading}
            onChange={(e) => update("paper_authors", e.target.value)}
            placeholder="Sonawane, Chaudhari, Hile, Tiwari, Mendke"
          />
        </div>

        <div className="field">
          <label htmlFor="summary">
            Summary <span className="opt">optional</span>
          </label>
          <textarea
            id="summary"
            value={values.paper_summary}
            disabled={uploading}
            onChange={(e) => update("paper_summary", e.target.value)}
            placeholder="A sentence or two to help you recognise this paper later."
          />
        </div>

        <button type="submit" className="submit" disabled={uploading}>
          {!uploading
            ? "Upload and index"
            : sent
              ? "Finishing upload…"
              : `Uploading ${percent}%`}
        </button>

        {error && (
          <div className="msg err" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="msg ok" role="status">
            {notice}
          </div>
        )}
      </form>
    </div>
  );
}
