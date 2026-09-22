import type {
  AskResponse,
  IndexAccepted,
  IndexFormValues,
  IndexStatusResponse,
  Paper,
  Source,
} from "./types";

export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

/** Every backend route in one place. Change paths here and nowhere else. */
export const ROUTES = {
  /** POST, multipart. Responds 202 with { paper_id, status }. */
  index: `${API_BASE}/research/index`,

  /** GET. Returns all papers stored in the DB (all statuses). */
  papers: `${API_BASE}/research/papers`,

  /** GET. Polled with the paper_id returned by the 202 above. */
  status: (paperId: string) =>
    `${API_BASE}/research/${encodeURIComponent(paperId)}/status`,

  /** POST, JSON { question, paper_ids }. */
  ask: `${API_BASE}/research/ask`,
} as const;

export const MAX_BYTES = 10 * 1024 * 1024;

/** An HTTP failure that remembers its status code, so callers can react to 404s. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
}

/**
 * FastAPI sends `detail` as a string for HTTPException, but as an array
 * of issues for 422 validation errors. Handle both, so a 422 says which
 * field failed instead of just "Server returned 422".
 */
export function describeError(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((issue: ValidationIssue) => {
          const field = issue.loc?.[issue.loc.length - 1] ?? "field";
          return `${field}: ${issue.msg ?? "invalid"}`;
        })
        .join("; ");
    }
  }
  return `Server returned ${status}`;
}

async function readError(res: Response): Promise<ApiError> {
  try {
    return new ApiError(describeError(await res.json(), res.status), res.status);
  } catch {
    return new ApiError(`Server returned ${res.status}`, res.status);
  }
}

/**
 * Sends the PDF and metadata. The server replies 202 as soon as it has
 * the file and indexes it in the background — so resolving here means
 * "accepted", not "indexed". Poll getIndexStatus() for the rest.
 *
 * Uses XMLHttpRequest because fetch has no upload-progress events.
 */
export function indexPaper(
  values: IndexFormValues,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<IndexAccepted> {
  const form = new FormData();
  form.append("paper_title", values.paper_title);
  form.append("paper_authors", values.paper_authors);
  form.append("paper_summary", values.paper_summary);
  form.append("file", file);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError("Upload cancelled.", 0));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", ROUTES.index);

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      cleanup();

      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        if (body && typeof body === "object" && "paper_id" in body) {
          resolve(body as IndexAccepted);
        } else {
          reject(
            new ApiError(
              "The server accepted the upload but didn't return a paper id.",
              xhr.status,
            ),
          );
        }
        return;
      }

      reject(new ApiError(describeError(body, xhr.status), xhr.status));
    });

    xhr.addEventListener("error", () => {
      cleanup();
      reject(new ApiError("Couldn't reach the server. Is it running?", 0));
    });

    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new ApiError("Upload cancelled.", 0));
    });

    // FormData sets multipart/form-data *and* its boundary. Setting
    // Content-Type by hand would drop the boundary and break parsing.
    xhr.send(form);
  });
}

export async function getIndexStatus(
  paperId: string,
  signal?: AbortSignal,
): Promise<IndexStatusResponse> {
  const res = await fetch(ROUTES.status(paperId), { signal });
  if (!res.ok) throw await readError(res);
  return res.json() as Promise<IndexStatusResponse>;
}

/** Shape of each element in the GET /research/papers response. */
interface ServerPaper {
  paper_id: string;
  paper_title: string;
  paper_authors?: string | null;
  paper_summary?: string | null;
  status: Paper["status"];
  chunks?: number | null;
}

/**
 * Fetch all papers stored in the DB and map them to the frontend Paper type.
 * Called once on page load so the Explore section is pre-populated.
 */
export async function getAllPapers(signal?: AbortSignal): Promise<Paper[]> {
  const res = await fetch(ROUTES.papers, { signal });
  if (!res.ok) throw await readError(res);
  const list = (await res.json()) as ServerPaper[];
  return list.map((p) => ({
    paper_id: p.paper_id,
    paper_title: p.paper_title,
    paper_authors: p.paper_authors ?? undefined,
    paper_summary: p.paper_summary ?? undefined,
    status: p.status,
    chunks: p.chunks ?? undefined,
    error: undefined,
    // Papers from the server are either terminal (done/failed) or stuck from
    // a previous run. Setting submitted_at to 0 means the polling hook will
    // immediately flag any still-processing paper as failed (overdue check).
    submitted_at: 0,
  }));
}

export async function askQuestion(
  question: string,
  paperIds: string[],
): Promise<AskResponse> {
  const res = await fetch(ROUTES.ask, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, paper_ids: paperIds }),
  });
  if (!res.ok) throw await readError(res);
  return res.json() as Promise<AskResponse>;
}

/**
 * Stream an answer from the server via SSE.
 *
 * The server sends:
 *   event: token   — each text chunk as it is generated
 *   event: done    — final payload { sources: Source[] }
 *   event: error   — error message string
 *
 * Callbacks fire as events arrive.  The returned promise resolves once the
 * stream closes (or rejects on a network-level failure).
 */
export async function streamAskQuestion(
  question: string,
  paperIds: string[],
  onToken: (text: string) => void,
  onDone: (sources: Source[]) => void,
  onError: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(ROUTES.ask, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, paper_ids: paperIds }),
    signal,
  });
  if (!res.ok) throw await readError(res);
  if (!res.body) throw new ApiError("No response body.", 0);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are delimited by blank lines (\n\n).
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? ""; // Keep any incomplete trailing chunk.

      for (const raw of events) {
        if (!raw.trim()) continue;
        let eventType = "message";
        let data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) data = line.slice(6);
        }
        if (!data) continue;

        const payload = JSON.parse(data) as unknown;
        if (eventType === "token") onToken(payload as string);
        else if (eventType === "done")
          onDone((payload as { sources: Source[] }).sources ?? []);
        else if (eventType === "error") onError(payload as string);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
