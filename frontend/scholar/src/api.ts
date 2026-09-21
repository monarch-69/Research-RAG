import type {
  AskResponse,
  IndexAccepted,
  IndexFormValues,
  IndexStatusResponse,
} from "./types";

export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

/** Every backend route in one place. Change paths here and nowhere else. */
export const ROUTES = {
  /** POST, multipart. Responds 202 with { paper_id, status }. */
  index: `${API_BASE}/research/index`,

  /**
   * GET. Polled with the paper_id returned by the 202 above.
   *
   * Path-parameter style — matches  @router.get("/index/{paper_id}/status")
   */
  status: (paperId: string) =>
    `${API_BASE}/research/${encodeURIComponent(paperId)}/status`,

  // Query-parameter style — use this instead if your route is
  //   @router.get("/index/status")  with  paper_id: str  as a parameter:
  //
  // status: (paperId: string) =>
  //   `${API_BASE}/research/index/status?paper_id=${encodeURIComponent(paperId)}`,

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

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
