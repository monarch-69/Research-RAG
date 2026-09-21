from fastapi import Request
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel
import os


class Config(BaseModel):
    chroma_collection_name: str
    chroma_persistant_dir: str
    upload_file_limit: int
    meta_db_name: str
    paper_store_dir: str

# We did load_env() here now just read those env's
def load_config(
    collection_name: str | None = None,
    persistant_dir: str | None = None,
    upload_file_limit: int | None = None, # In MB's
    meta_db_name: str | None = None,
    paper_store_dir: str | None = None
) -> Config:
    _collection_name: str = collection_name or os.getenv("CHROMA_COLLECTION_NAME") or "research_papers"
    _persistant_dir: str = persistant_dir or os.getenv("CHROMA_PERSISTANT_DIR") or "rag-store/chroma"
    _upload_file_limit: int = upload_file_limit or int(os.getenv("UPLOAD_FILE_LIMIT") or 100)
    _meta_db_name: str = meta_db_name or os.getenv("META_DB_NAME") or "research_rag"
    _paper_store_dir: str = paper_store_dir or os.getenv("PAPER_STORE_DIR") or "user-papers/store"

    return Config(
        chroma_collection_name=_collection_name,
        chroma_persistant_dir=_persistant_dir,
        upload_file_limit=_upload_file_limit,
        meta_db_name=_meta_db_name,
        paper_store_dir=_paper_store_dir
    )

# Our DB dependency function (we'll inject this as dependency using `Depends`)
async def get_meta_db(request: Request):
    _conn_pool: AsyncConnectionPool = request.app.state.meta_db

    async with _conn_pool.connection() as _connection:
        yield _connection
