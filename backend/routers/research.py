from typing import List
from math import ceil
from fastapi import APIRouter, Depends, File, Form, UploadFile, Request, HTTPException
from fastapi.background import BackgroundTasks
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.prebuilt import create_react_agent
from uuid_utils import uuid7
import asyncio

from utils import (
    logger,
    get_meta_db,
    indexer_bg_worker,
    AskRequest,
    _ASK_SYSTEM,
    make_search_tool,
)

router: APIRouter = APIRouter(prefix="/research")


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


# ── Ask ─────────────────────────────────────────────────────────────────────

@router.post("/ask")
async def ask_papers(request: Request, body: AskRequest):
    if not body.paper_ids:
        raise HTTPException(status_code=422, detail="paper_ids must not be empty.")
    if not body.question.strip():
        raise HTTPException(status_code=422, detail="question must not be empty.")

    search_tool, retrieved_docs = make_search_tool(
        request.app.state.vector_store, body.paper_ids
    )

    agent = create_react_agent(request.app.state.llm, tools=[search_tool])

    try:
        result = await asyncio.to_thread(
            agent.invoke,
            {
                "messages": [
                    SystemMessage(content=_ASK_SYSTEM),
                    HumanMessage(content=body.question),
                ]
            },
        )
        answer: str = str(result["messages"][-1].content)
    except Exception:
        logger.exception("Agent failed for question %r", body.question)
        raise HTTPException(status_code=500, detail="Agent request failed.")

    # Build deduplicated source list from everything the tool retrieved.
    sources = []
    seen: set[tuple[str, str]] = set()
    for doc in retrieved_docs:
        pid = doc.metadata.get("id", "")
        excerpt = doc.page_content.strip()[:500]
        key = (pid, excerpt[:80])
        if key not in seen:
            seen.add(key)
            sources.append({
                "paper_id": pid,
                "paper_name": doc.metadata.get("name", "Unknown"),
                "excerpt": excerpt,
                "section": None,
            })

    return {"answer": answer, "sources": sources}
