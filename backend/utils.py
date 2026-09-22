from dataclasses import dataclass
from typing import List, Tuple
from fastapi import Request
from langchain_core.documents import Document
from langchain_core.tools import tool as lc_tool
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel
import asyncio
import logging
import numpy as np
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
    "Answer the user's question using ONLY the context passages provided. "
    "Do not rely on prior knowledge or memory. "
    "If the provided context does not contain the answer, say: "
    "'I couldn't find that information in the selected papers.' "
    "Be concise and accurate. "
    "At the very end of your response, on its own line, write exactly:\n"
    "####RELEVANT####\n"
    "then copy the single most relevant passage verbatim from the context above."
)

_RELEVANT_MARKER = "####RELEVANT####"


# ── Semantic cache ─────────────────────────────────────────────────────────────

@dataclass
class _CacheEntry:
    embedding: list
    paper_ids: frozenset
    answer: str
    sources: list


class SemanticCache:
    """In-memory semantic cache keyed on (question embedding, paper_ids set).

    Two questions with cosine similarity ≥ threshold scoped to the same paper
    set return the cached answer without hitting the vector store or LLM.
    """

    def __init__(self, embedding_model, threshold: float = 0.92):
        self._model = embedding_model
        self._threshold = threshold
        self._entries: List[_CacheEntry] = []

    def _cosine(self, a: list, b: list) -> float:
        va = np.array(a, dtype=np.float32)
        vb = np.array(b, dtype=np.float32)
        denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
        return float(np.dot(va, vb) / denom) if denom else 0.0

    def lookup(self, question: str, paper_ids: frozenset) -> Tuple:
        """Return (answer, sources, embedding).

        On a hit, answer and sources are the cached values.
        On a miss, answer and sources are None; embedding is always returned
        so the caller can pass it directly to store() without re-embedding.
        """
        emb = self._model.embed_query(question)
        for entry in self._entries:
            if entry.paper_ids != paper_ids:
                continue
            if self._cosine(emb, entry.embedding) >= self._threshold:
                logger.info("Semantic cache HIT (%.3f) for %r", self._cosine(emb, entry.embedding), question[:60])
                return entry.answer, entry.sources, emb
        return None, None, emb

    def store(self, embedding: list, paper_ids: frozenset, answer: str, sources: list) -> None:
        self._entries.append(_CacheEntry(
            embedding=embedding,
            paper_ids=paper_ids,
            answer=answer,
            sources=sources,
        ))


# ── LLM streaming helpers ──────────────────────────────────────────────────────

def _extract_token(chunk) -> str:
    """Extract plain text from an LLM stream chunk (handles Gemini content blocks)."""
    content = chunk.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text", "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _parse_response(full_response: str, retrieved_docs: List[Document]) -> Tuple[str, list]:
    """Split the model's full response on the ####RELEVANT#### marker.

    Returns (clean_answer, sources).  Sources is a one-element list when the
    model included a best-passage excerpt, otherwise empty.
    """
    if _RELEVANT_MARKER in full_response:
        answer_part, relevant_text = full_response.split(_RELEVANT_MARKER, 1)
        clean_answer = answer_part.strip()
        relevant_text = relevant_text.strip()

        source = None
        if retrieved_docs and relevant_text:
            rel_words = set(relevant_text.lower().split())
            best_doc = max(
                retrieved_docs,
                key=lambda d: len(rel_words & set(d.page_content.lower().split())),
            )
            source = {
                "paper_id": best_doc.metadata.get("id", ""),
                "paper_name": best_doc.metadata.get("name", "Unknown"),
                "excerpt": relevant_text[:500],
                "section": None,
            }
        return clean_answer, [source] if source else []
    return full_response.strip(), []


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
