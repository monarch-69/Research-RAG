from typing import List
from math import ceil
from fastapi import APIRouter, Depends, File, Form, UploadFile, Request, HTTPException
from fastapi.background import BackgroundTasks
from langchain_chroma import Chroma
from psycopg_pool import AsyncConnectionPool
from uuid_utils import uuid7, UUID
from vector_store import build_index
from pathlib import Path
import asyncio
import logging
import os

from utils import get_meta_db

logger = logging.getLogger(__name__)

router: APIRouter = APIRouter(
    prefix="/research"
)


async def indexer_bg_worker(
    request: Request,
    paper_id: str,
    paper_title: str,
    content: bytes,
):
    try:
        chunks_created: int = await asyncio.to_thread(
            build_index, request.app.state.vector_store, paper_id, paper_title, pdf_content=content
        )
        async with request.app.state.meta_db.connection() as connection:
            await connection.execute(
                "UPDATE paper_store SET status = 'done', paper_chunks_created = %s WHERE paper_id = %s",
                (chunks_created, paper_id),
            )
    except Exception:
        logger.exception("Failed to index paper %s", paper_id)
        try:
            async with request.app.state.meta_db.connection() as connection:
                await connection.execute(
                    "UPDATE paper_store SET status = 'failed' WHERE paper_id = %s",
                    (paper_id,),
                )
        except Exception:
            logger.exception("Could not mark paper %s as failed", paper_id)


@router.post("/index", status_code=202)
async def index_research_paper(
    request: Request,
    bg_worker: BackgroundTasks,
    paper_title: str = Form(...),
    paper_summary: str | None = Form(None),
    paper_authors: str | None = Form(None),
    file: UploadFile = File(...),
    connection = Depends(get_meta_db),
):
    size_in_mb: int = ceil((file.size or 0) / 1024 / 1024)

    if size_in_mb <= 0 or size_in_mb > 101:
        raise HTTPException(
            status_code=422,
            detail=f"File should be greater than 0 and lesser than 100 MB. Current size `{size_in_mb}` MB"
        )

    file_content: bytes = await file.read()
    paper_id: str = str(uuid7())
    _paper_authors: List[str] = [author.strip() for author in (paper_authors or "").split(',')]

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
                raise HTTPException(status_code=500, detail="Internal Server Error: Inserting into DB")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Internal Server Error; {e}")

    # Commit before scheduling the background task so the worker's UPDATE
    # can see the newly inserted row from a separate connection.
    await connection.commit()

    bg_worker.add_task(indexer_bg_worker, request, paper_id, paper_title, file_content)
    return {
        "operation": "success -> pooled",
        "file": paper_title,
        "size": size_in_mb,
        "paper_id": paper_id,
        "status": "processing",
    }


@router.get("/{paper_id}/status", status_code=200)
async def get_paper_status(
    paper_id: str,
    connection = Depends(get_meta_db)
):
    async with connection.cursor() as cursor:
        await cursor.execute(
            "SELECT status, paper_chunks_created FROM paper_store WHERE paper_id = %s",
            (paper_id,),
        )
        res = await cursor.fetchone()

    if res is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    return {
        "paper_id": paper_id,
        "status": res[0],
        "chunks": res[1],
        "error": None,
    }
