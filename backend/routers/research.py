from typing import List
from math import ceil
from fastapi import APIRouter, Depends, File, Form, UploadFile, Request, HTTPException
from fastapi.background import BackgroundTasks
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, SystemMessage
from uuid_utils import uuid7
import asyncio
import json

from utils import (
    SemanticCache,
    logger,
    get_meta_db,
    indexer_bg_worker,
    AskRequest,
    _ASK_SYSTEM,
    _RELEVANT_MARKER,
    _extract_token,
    _parse_response,
    make_search_tool,
)

router: APIRouter = APIRouter(prefix="/research")

# These headers are mandatory for SSE to work through browsers and reverse proxies.
# Without Cache-Control: no-cache the response body is buffered until the connection
# closes, so the client sees nothing until the stream ends — appearing "stuck".
_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",  # tells nginx not to buffer
}


# ── Upload & index ─────────────────────────────────────────────────────────

@router.post("/index", status_code=202)
async def index_research_paper(
    request: Request,
    bg_worker: BackgroundTasks,
    paper_title: str = Form(...),
    paper_summary: str | None = Form(None),
    paper_authors: str | None = Form(None),
    file: UploadFile = File(...),
    connection=Depends(get_meta_db),
):
    size_in_mb: int = ceil((file.size or 0) / 1024 / 1024)

    if size_in_mb <= 0 or size_in_mb > 101:
        raise HTTPException(
            status_code=422,
            detail=f"File size must be between 1 and 100 MB (got {size_in_mb} MB).",
        )

    file_content: bytes = await file.read()
    paper_id: str = str(uuid7())
    _paper_authors: List[str] = [a.strip() for a in (paper_authors or "").split(",")]

    async with connection.cursor() as cursor:
        try:
            await cursor.execute(
                """
                INSERT INTO paper_store (
                    paper_id, paper_title, paper_summary, paper_authors, paper_size, status
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (paper_id, paper_title, paper_summary, _paper_authors, size_in_mb, "processing"),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=500, detail="DB insert returned 0 rows.")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"DB error: {e}")

    # Commit so the background worker can see the row via its own connection.
    await connection.commit()

    bg_worker.add_task(indexer_bg_worker, request, paper_id, paper_title, file_content)
    return {"paper_id": paper_id, "status": "processing"}


# ── List all papers ─────────────────────────────────────────────────────────
# Defined before /{paper_id}/status to prevent "papers" being eaten as a UUID.

@router.get("/papers", status_code=200)
async def list_papers(connection=Depends(get_meta_db)):
    """Return every paper in the DB (all statuses) for the Explore page."""
    async with connection.cursor() as cursor:
        await cursor.execute(
            """
            SELECT paper_id, paper_title, paper_summary, paper_authors, status, paper_chunks_created
            FROM paper_store
            """
        )
        rows = await cursor.fetchall()

    return [
        {
            "paper_id": row[0],
            "paper_title": row[1],
            "paper_summary": row[2],
            "paper_authors": ", ".join(row[3]) if row[3] else None,
            "status": row[4],
            "chunks": row[5],
        }
        for row in rows
    ]


# ── Per-paper status ────────────────────────────────────────────────────────

@router.get("/{paper_id}/status", status_code=200)
async def get_paper_status(paper_id: str, connection=Depends(get_meta_db)):
    async with connection.cursor() as cursor:
        await cursor.execute(
            "SELECT status, paper_chunks_created FROM paper_store WHERE paper_id = %s",
            (paper_id,),
        )
        res = await cursor.fetchone()

    if res is None:
        raise HTTPException(status_code=404, detail="Paper not found.")

    return {"paper_id": paper_id, "status": res[0], "chunks": res[1], "error": None}


# ── Ask (SSE streaming + semantic cache) ────────────────────────────────────

@router.post("/ask")
async def ask_papers(request: Request, body: AskRequest):
    if not body.paper_ids:
        raise HTTPException(status_code=422, detail="paper_ids must not be empty.")
    if not body.question.strip():
        raise HTTPException(status_code=422, detail="question must not be empty.")

    llm = request.app.state.llm
    vector_store = request.app.state.vector_store
    cache: SemanticCache = request.app.state.semantic_cache
    paper_ids_set = frozenset(body.paper_ids)

    # ── Semantic cache check ─────────────────────────────────────────────────
    # embed_query is a blocking Ollama call; run it off the event loop.
    cached_answer, cached_sources, question_emb = await asyncio.to_thread(
        cache.lookup, body.question, paper_ids_set
    )

    if cached_answer is not None:
        async def _cached_stream():
            yield f"event: token\ndata: {json.dumps(cached_answer)}\n\n"
            yield f"event: done\ndata: {json.dumps({'sources': cached_sources})}\n\n"

        return StreamingResponse(_cached_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)

    # ── Retrieval ────────────────────────────────────────────────────────────
    search_tool, retrieved_docs = make_search_tool(vector_store, body.paper_ids)

    try:
        passages: str = await asyncio.to_thread(search_tool.invoke, body.question)
    except Exception:
        logger.exception("Search tool failed for %r", body.question)
        raise HTTPException(status_code=500, detail="Vector search failed.")

    if not retrieved_docs:
        no_ctx = "I couldn't find relevant passages in the selected papers for your question."

        async def _empty_stream():
            yield f"event: token\ndata: {json.dumps(no_ctx)}\n\n"
            yield f"event: done\ndata: {json.dumps({'sources': []})}\n\n"

        return StreamingResponse(_empty_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)

    # ── Streaming LLM generation ─────────────────────────────────────────────
    messages = [
        SystemMessage(content=_ASK_SYSTEM),
        HumanMessage(
            content=(
                f"Context from research papers:\n\n{passages}\n\n"
                f"---\n\nQuestion: {body.question}"
            )
        ),
    ]

    async def _live_stream():
        full_response = ""
        pending = ""       # Sliding buffer to suppress the ####RELEVANT#### marker
        marker_found = False
        sources_to_send: list = []

        try:
            # Use a per-chunk timeout so a slow/hung LLM doesn't freeze the UI.
            aiter = llm.astream(messages).__aiter__()
            while True:
                try:
                    chunk = await asyncio.wait_for(aiter.__anext__(), timeout=60.0)
                except StopAsyncIteration:
                    break

                token = _extract_token(chunk)
                if not token:
                    continue

                full_response += token

                if marker_found:
                    continue  # quietly collect the relevant passage

                pending += token

                if _RELEVANT_MARKER in pending:
                    marker_found = True
                    before = pending[: pending.index(_RELEVANT_MARKER)]
                    if before:
                        yield f"event: token\ndata: {json.dumps(before)}\n\n"
                    pending = ""
                    continue

                # Emit the safe prefix (far enough from the tail to not be
                # the start of the marker).
                safe_len = len(pending) - len(_RELEVANT_MARKER)
                if safe_len > 0:
                    yield f"event: token\ndata: {json.dumps(pending[:safe_len])}\n\n"
                    pending = pending[safe_len:]

            # Flush any remaining buffer (marker never appeared)
            if pending and not marker_found:
                yield f"event: token\ndata: {json.dumps(pending)}\n\n"

            clean_answer, sources_to_send = _parse_response(full_response, retrieved_docs)
            cache.store(question_emb, paper_ids_set, clean_answer, sources_to_send)

        except asyncio.TimeoutError:
            logger.warning("LLM timed out (60 s) for %r", body.question)
            yield f"event: error\ndata: {json.dumps('LLM response timed out — please try again.')}\n\n"
        except Exception:
            logger.exception("LLM streaming failed for %r", body.question)
            yield f"event: error\ndata: {json.dumps('LLM request failed.')}\n\n"

        # Always send done so the client can clear its busy state.
        yield f"event: done\ndata: {json.dumps({'sources': sources_to_send})}\n\n"

    return StreamingResponse(_live_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)
