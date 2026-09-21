from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.requests import Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_chroma import Chroma
from langchain_core.vectorstores import VectorStore
from langchain_core.embeddings import Embeddings
from langchain_ollama import OllamaEmbeddings
from psycopg_pool import AsyncConnectionPool
import os

from vector_store import create_vector_handle
from utils import Config, load_config

@asynccontextmanager
async def lifespan(app: FastAPI):
    embedding_model: OllamaEmbeddings = OllamaEmbeddings(model="mxbai-embed-large")
    config: Config = load_config()
    app.state.config = config
    app.state.embedding_model = embedding_model
    app.state.vector_store = create_vector_handle(
        embedding_model,
        config.chroma_collection_name,
        config.chroma_persistant_dir
    )
    # Now time to initialize meta-database (cool name for our postgres database)
    # This would hold our metadata (id of the pdf, name, short summary of this pdf, etc (If I could think of more))
    pg_pool: AsyncConnectionPool = AsyncConnectionPool(
        "postgres://sage:12345@localhost/research_rag",
        max_size=20,
        timeout=5,
        open=False
    )
    await pg_pool.open()
    app.state.meta_db = pg_pool

    yield
    
    await app.state.meta_db.close()

app: FastAPI = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

from routers.research import router as research_router
app.include_router(research_router)

@app.get("/")
def greetings():
    return {
        "Content": "Greetings",
        "From": "System"
    }
