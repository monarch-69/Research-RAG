# Scholar

A web app for uploading research papers (PDFs) and asking questions about their content. Answers are grounded solely in what the papers contain — the LLM cannot draw from its own training knowledge.

## What it does

- **Upload PDFs** — file is accepted immediately and indexed in the background so you can keep using the app
- **Ask questions** — a chat interface retrieves relevant passages from the indexed papers and streams the LLM answer token by token
- **Source attribution** — each answer cites the passage from the paper that best supports it
- **Explore papers** — browse all indexed papers; ask questions scoped to a single paper or across your whole library
- **Semantic cache** — questions with cosine similarity ≥ 0.92 against a previously answered question (for the same paper set) return the cached answer without hitting the vector store or LLM. The cache is in-memory and resets when the server restarts.

## Stack

| Layer | Technology |
|---|---|
| Backend | Python · FastAPI · psycopg3 |
| Vector store | ChromaDB (persisted to disk) |
| Embeddings | Ollama — `mxbai-embed-large` |
| LLM | Google Gemini (configured in `backend/app.py`) |
| Metadata DB | PostgreSQL |
| Frontend | React · TypeScript · Vite |

## Prerequisites

- Python 3.11+
- Node.js 18+
- [Ollama](https://ollama.com) running locally with `mxbai-embed-large` pulled
- PostgreSQL running locally
- A Google AI API key from [aistudio.google.com](https://aistudio.google.com)

## Setup

### 1 — PostgreSQL

Create the database and table:

```sql
CREATE DATABASE research_rag;

\c research_rag

CREATE TABLE paper_store (
    paper_id             TEXT PRIMARY KEY,
    paper_title          TEXT NOT NULL,
    paper_summary        TEXT,
    paper_authors        TEXT[],
    paper_size           INTEGER,
    status               TEXT NOT NULL DEFAULT 'processing',
    paper_chunks_created INTEGER
);
```

The connection string is hardcoded in `backend/app.py` as:

```
postgres://sage:12345@localhost/research_rag
```

Change it there if your PostgreSQL user, password, or database name differs.

### 2 — Ollama

```bash
ollama pull mxbai-embed-large
```

Ollama must be running (`ollama serve`) before the backend starts.

### 3 — Backend

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

### 4 — Frontend

```bash
cd frontend/scholar
npm install
npm run dev
```

App opens at `http://localhost:5173`.

If your backend is on a different port, copy `.env.example` to `.env` and set `VITE_API_BASE`.
