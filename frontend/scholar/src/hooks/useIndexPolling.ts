import { useEffect, useRef } from "react";
import { ApiError, getIndexStatus } from "../api";
import { isTerminal } from "../types";
import type { Paper } from "../types";

const FIRST_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;
const BACKOFF = 1.5;
/** Stop waiting on a paper that still hasn't finished after this long. */
const GIVE_UP_AFTER_MS = 10 * 60 * 1000;

export type PaperPatch = Partial<Pick<Paper, "status" | "chunks" | "error">>;

/**
 * Polls the status endpoint for every paper that hasn't finished yet.
 *
 * One loop serves all pending papers. It starts at 1s and backs off to
 * 5s, so a long job doesn't hammer the server. The loop restarts only
 * when the *set* of pending papers changes — a paper finishing, or a
 * new one being uploaded.
 */
export function useIndexPolling(
  papers: Paper[],
  onUpdate: (paperId: string, patch: PaperPatch) => void,
): void {
  // Refs let the loop read the latest values without restarting on
  // every render.
  const onUpdateRef = useRef(onUpdate);
  const papersRef = useRef(papers);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
    papersRef.current = papers;
  });

  const pendingKey = papers
    .filter((p) => !isTerminal(p.status))
    .map((p) => p.paper_id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!pendingKey) return;

    const ids = pendingKey.split(",");
    const controller = new AbortController();
    let delay = FIRST_DELAY_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      const results = await Promise.allSettled(
        ids.map((id) => getIndexStatus(id, controller.signal)),
      );
      if (controller.signal.aborted) return;

      const now = Date.now();

      results.forEach((result, i) => {
        const id = ids[i];
        const paper = papersRef.current.find((p) => p.paper_id === id);
        const overdue =
          paper !== undefined && now - paper.submitted_at > GIVE_UP_AFTER_MS;

        if (result.status === "fulfilled") {
          const { status, chunks, error } = result.value;

          if (!isTerminal(status) && overdue) {
            onUpdateRef.current(id, {
              status: "failed",
              error: "Indexing took too long. Try uploading it again.",
            });
            return;
          }

          onUpdateRef.current(id, {
            status,
            chunks: chunks ?? undefined,
            error: error ?? undefined,
          });
          return;
        }

        // 404: the server has no record of this paper — typically it
        // restarted and lost the job. Waiting longer won't help.
        const reason: unknown = result.reason;
        if (reason instanceof ApiError && reason.status === 404) {
          onUpdateRef.current(id, {
            status: "failed",
            error: "The server has no record of this paper. Upload it again.",
          });
          return;
        }

        // Anything else is usually a brief blip; keep trying until the
        // deadline passes.
        if (overdue) {
          onUpdateRef.current(id, {
            status: "failed",
            error: "Lost contact with the server while this paper was indexing.",
          });
        }
      });

      delay = Math.min(delay * BACKOFF, MAX_DELAY_MS);
      timer = setTimeout(tick, delay);
    }

    timer = setTimeout(tick, delay);

    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pendingKey]);
}
