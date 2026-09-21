# Scholar — frontend

Upload a research paper, let it index in the background, then ask
questions answered from the paper's own passages.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173

Keep the project under your Linux home directory (`~`), not `/mnt/c` or
`/mnt/d` — `node_modules` is tens of thousands of small files and the
Windows-drive mount makes installs and rebuilds very slow.

If the browser can't connect while Vite runs inside WSL, the config
already binds `0.0.0.0`. Failing that, find the distro's address with
`ip addr show eth0 | grep 'inet '` and use it instead of `localhost`.

## Point it at your backend

Defaults to `http://localhost:8000`. To change it:

```bash
cp .env.example .env   # then edit VITE_API_BASE
```

Route paths live in one place: `ROUTES` in `src/api.ts`.

## The backend contract

### `POST /research/index` → **202 Accepted**

Multipart form:

| field           | type                |
| --------------- | ------------------- |
| `paper_title`   | string, required    |
| `paper_authors` | string, may be `""` |
| `paper_summary` | string, may be `""` |
| `file`          | PDF, max 10 MB      |

Respond as soon as the file is received, and index in a background task:

```json
{ "paper_id": "a1b2c3", "status": "queued" }
```

### `GET /research/index/{paper_id}/status`

```json
{ "paper_id": "a1b2c3", "status": "processing", "chunks": null, "error": null }
```

`status` is one of `queued`, `processing`, `done`, `failed`.
Set `chunks` when done and `error` when failed. Return **404** for an
unknown id — the frontend stops polling that paper instead of waiting.

The frontend polls every pending paper, starting at 1 s and backing off
to 5 s, and gives up after 10 minutes.

### `POST /research/ask`

```json
{ "question": "Who are the authors?", "paper_ids": ["a1b2c3"] }
```

```json
{
  "answer": "The authors are …",
  "sources": [
    {
      "paper_id": "a1b2c3",
      "paper_name": "AI Assistant For Disabled",
      "excerpt": "Authors and Affiliations of paper …",
      "section": "front_matter"
    }
  ]
}
```

### CORS

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Layout

```
index.html                 Vite entry — stays at the project root
package.json
vite.config.ts
tsconfig.json
src/
  main.tsx                 mounts <App />
  App.tsx                  page shell; owns the list of papers
  api.ts                   typed HTTP calls and every route path
  types.ts                 the frontend/backend contract
  styles.css
  hooks/
    useIndexPolling.ts     polls status for papers still indexing
  components/
    IndexForm.tsx          upload and metadata form
    Library.tsx            your papers and their indexing status
    AskPanel.tsx           question box and answer transcript
    PdfGlyph.tsx           file icon
```

The size and type checks in the browser are a convenience. Validate
again on the server.
