# Scholar

A web app for uploading research papers (PDFs) and asking questions about their content. Answers are generated from passages retrieved from your uploaded papers, and the LLM is instructed to answer only from that retrieved context.

## What it does

- **Upload PDFs** — the file is accepted immediately and indexed in the background, so you can keep using the app while it processes
- **Track indexing** — each paper's indexing status is stored in PostgreSQL
- **Ask questions** — a chat interface retrieves relevant passages from the indexed papers and streams the LLM answer token by token
- **Source attribution** — each answer cites the passage from the paper that best supports it
- **Explore papers** — browse all indexed papers; ask questions scoped to a single paper or across your whole library
- **Semantic cache** — questions with cosine similarity ≥ 0.92 against a previously answered question (for the same paper set) return the cached answer without hitting the vector store or LLM

## Stack

| Layer | Technology |
|---|---|
| Backend | Python · FastAPI · psycopg3 |
| RAG framework | LangChain |
| Vector store | ChromaDB (persisted to disk) |
| Embeddings | Ollama — `mxbai-embed-large` |
| LLM | Google Gemini (configured in `backend/app.py`) |
| Metadata DB | PostgreSQL |
| Frontend | React · TypeScript · Vite |

## Project structure

```
backend/            FastAPI server, ingestion and retrieval logic
frontend/scholar/   React + TypeScript frontend (Vite)
```

## Prerequisites

- Python 3.11+
- Node.js and npm
- [Ollama](https://ollama.com) running locally with `mxbai-embed-large` pulled
- PostgreSQL running locally
- A Google AI API key from [aistudio.google.com](https://aistudio.google.com)

## Setup

### 1 - PostgreSQL

Create the database and table:

```sql
CREATE DATABASE research_rag;

\c research_rag

CREATE TABLE paper_store (
    paper_id             UUID PRIMARY KEY,
    paper_title          TEXT,
    paper_summary        TEXT,
    paper_authors        TEXT[],
    paper_size           NUMERIC,          -- file size in MB
    paper_chunks_created INTEGER,
    indexed              BOOLEAN DEFAULT FALSE,
    status               TEXT,             -- set to 'new' on upload
    error                TEXT
);
```

The connection string is currently hardcoded in `backend/app.py` in this form:

```
postgres://<user>:<password>@localhost/research_rag
```

Update it there to match your PostgreSQL user, password, and database name.

### 2 - Ollama

```bash
ollama pull mxbai-embed-large
```

Ollama must be running (`ollama serve`) before the backend starts.

### 3 - Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:

```env
GOOGLE_API_KEY=your_key_here
CHROMA_COLLECTION_NAME=research_papers
CHROMA_PERSISTANT_DIR=rag-store/chroma
UPLOAD_FILE_LIMIT=100
META_DB_NAME=research_rag
PAPER_STORE_DIR=user-papers/store
```

Start the server:

```bash
uvicorn app:app --reload
```

API runs at `http://localhost:8000`.

### 4 - Frontend

```bash
cd frontend/scholar
npm install
npm run dev
```

App opens at `http://localhost:5173`.

If your backend is on a different port, copy `.env.example` to `.env` and set `VITE_API_BASE`.

## Known limitations

- The semantic cache is in-memory and resets when the server restarts.
- Grounding is enforced through prompting, so the LLM may still occasionally draw on its own training knowledge.
- The PostgreSQL connection string is hardcoded rather than read from `.env`.
