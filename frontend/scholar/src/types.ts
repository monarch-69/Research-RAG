// The contract between this frontend and the FastAPI backend.
// Rename a field on the server? Rename it here too, and the compiler
// will point at every place that needs to change.

/** Where a paper is in the background indexing job. */
export type IndexStatus = "queued" | "processing" | "done" | "failed";

/** A finished job never changes again, so there is nothing left to poll. */
export function isTerminal(status: IndexStatus): boolean {
  return status === "done" || status === "failed";
}

/** A paper the user has submitted, at whatever stage it has reached. */
export interface Paper {
  paper_id: string;
  paper_title: string;
  paper_authors?: string;
  paper_summary?: string;
  status: IndexStatus;
  chunks?: number;
  error?: string;
  /** Epoch ms when the server accepted the upload; used to stop polling. */
  submitted_at: number;
}

/** 202 body from POST /research/index. */
export interface IndexAccepted {
  paper_id: string;
  status?: IndexStatus;
}

/** Body from GET /research/index/{paper_id}/status. */
export interface IndexStatusResponse {
  paper_id: string;
  status: IndexStatus;
  chunks?: number | null;
  error?: string | null;
}

/** One retrieved passage backing an answer. */
export interface Source {
  paper_id: string;
  paper_name: string;
  excerpt: string;
  section?: string;
}

/** Body from POST /research/ask. */
export interface AskResponse {
  answer: string;
  sources: Source[];
}

/** One question-and-answer exchange in the transcript. */
export interface Turn {
  id: string;
  question: string;
  answer: string | null; // null while the request is in flight
  sources: Source[];
  error: string | null;
}

/** The upload form's fields before they are sent. */
export interface IndexFormValues {
  paper_title: string;
  paper_authors: string;
  paper_summary: string;
}
