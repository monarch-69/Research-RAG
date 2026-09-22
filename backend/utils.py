from typing import List, Tuple
from fastapi import Request
from langchain_core.documents import Document
from langchain_core.tools import tool as lc_tool
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel
import asyncio
import logging
import os

from vector_store import build_index

logger = logging.getLogger(__name__)


class Config(BaseModel):
    chroma_collection_name: str
    chroma_persistant_dir: str
    upload_file_limit: int
    meta_db_name: str
    paper_store_dir: str


class AskRequest(BaseModel):
    question: str
    paper_ids: List[str]


_ASK_SYSTEM = (
    "You are a precise research assistant. "
    "Use the search_papers tool to retrieve relevant passages from the indexed papers. "
    "Always call the tool before answering — do not rely on memory or prior knowledge. "
    "After retrieving passages, answer using ONLY the retrieved information. "
    "If the tool returns no relevant passages, say: "
    "'I couldn't find that information in the selected papers.' "
    "Be concise."
)


def load_config(
    collection_name: str | None = None,
    persistant_dir: str | None = None,
    upload_file_limit: int | None = None,
    meta_db_name: str | None = None,
    paper_store_dir: str | None = None,
) -> Config:
    return Config(
        chroma_collection_name=collection_name or os.getenv("CHROMA_COLLECTION_NAME") or "research_papers",
        chroma_persistant_dir=persistant_dir or os.getenv("CHROMA_PERSISTANT_DIR") or "rag-store/chroma",
        upload_file_limit=upload_file_limit or int(os.getenv("UPLOAD_FILE_LIMIT") or 100),
        meta_db_name=meta_db_name or os.getenv("META_DB_NAME") or "research_rag",
        paper_store_dir=paper_store_dir or os.getenv("PAPER_STORE_DIR") or "user-papers/store",
    )


async def get_meta_db(request: Request):
    """FastAPI dependency: yields a checked-out pool connection."""
    _conn_pool: AsyncConnectionPool = request.app.state.meta_db
    async with _conn_pool.connection() as _connection:
        yield _connection


def make_search_tool(vector_store, paper_ids: List[str]) -> Tuple:
    """Create a similarity-search tool scoped to the given paper IDs.

    Returns ``(tool_fn, retrieved_docs)`` where ``retrieved_docs`` is a list
    that is populated with every Document retrieved when the tool is invoked.
    Pass the tool to the agent; inspect ``retrieved_docs`` afterwards to build
    the sources list for the API response.
    """
    retrieved: List[Document] = []

    chroma_filter = (
        {"id": paper_ids[0]}
        if len(paper_ids) == 1
        else {"id": {"$in": paper_ids}}
    )

    @lc_tool(parse_docstring=True)
    def search_papers(query: str) -> str:
        """
        Search indexed research papers and retrieve relevant passages.

        Args:
            query: Natural language search query to find relevant passages.

        Returns:
            Formatted passages from the research papers relevant to the query.
        """
        docs: List[Document] = vector_store.similarity_search(query, k=6, filter=chroma_filter)
        retrieved.extend(docs)

        if not docs:
            return "No relevant passages found in the selected papers."

        parts = [
            f"[Passage {i + 1} – {doc.metadata.get('name', 'Unknown')}]\n{doc.page_content}"
            for i, doc in enumerate(docs)
        ]
        return "\n\n---\n\n".join(parts)

    return search_papers, retrieved


async def indexer_bg_worker(
    request: Request,
    paper_id: str,
    paper_title: str,
    content: bytes,
) -> None:
    """Background task: index a PDF and update its status in the DB."""
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
