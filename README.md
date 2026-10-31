# AskBase

Ask questions about your own documents. Add notes, Markdown or PDF files, and AskBase answers from them with numbered citations back to the passages it used.

Each user only ever searches their own documents.

## How it works

```
Add document  → split into ~1000-char chunks on paragraph/line/word boundaries (200 overlap) → embed → store in Postgres (pgvector)
Ask question  → (follow-up? LLM rewrites it as a standalone question) → search → 5 chunks
              → LLM streams the answer from the chunks + chat history as JSON {answer, cited}
              → the UI shows the answer word by word, then only the cited sources
```

Search types (picked in the Ask box):

| Type          | How it searches                                                                 | Good for                    |
| ------------- | ------------------------------------------------------------------------------- | --------------------------- |
| `similarity`  | Nearest chunks by meaning (pgvector)                                            | Most questions, fastest     |
| `multi_query` | LLM writes 3 rewordings; each is searched and the results merged                | Vague questions, finds more |
| `hybrid`      | Meaning + Postgres full-text keyword search, merged with reciprocal rank fusion | Names, dates, IDs           |

- **Embeddings** run locally with [fastembed](https://github.com/qdrant/fastembed) (`BAAI/bge-small-en-v1.5`, 384 dims). The model downloads on first use.
- **Answers** come from the LLM you pick in `.env`: Claude, DeepSeek or GLM, called through [LangChain](https://python.langchain.com).
- **Tracing**: set `LANGSMITH_TRACING=true` (plus a key) to see every LLM call in the [LangSmith](https://smith.langchain.com) dashboard. Traces contain users' documents and go to LangSmith's cloud, so use test data.

## Stack

| Part     | Tech                                                 |
| -------- | ---------------------------------------------------- |
| Frontend | React 19, Vite, TypeScript, Tailwind 4, shadcn/ui    |
| Backend  | Python, APIFlask, psycopg, pypdf                     |
| Database | Postgres 18 + pgvector                               |
| LLM      | Anthropic SDK (Claude) or OpenAI SDK (DeepSeek, GLM) |

## Getting started

Needs Docker and [uv](https://docs.astral.sh/uv/).

```bash
make install   # creates .env from .env.example and a local venv for editor imports
```

Edit `.env` and set at least:

- `SECRET_KEY`: generate one with `python3 -c "import secrets; print(secrets.token_hex(32))"`
- `LLM_PROVIDER`: `claude`, `deepseek` or `glm`
- `LLM_API_KEY`: key for that provider

Then:

```bash
make start     # builds and runs db, backend and frontend
make url       # prints every local URL
```

Open http://127.0.0.1:5173, register, add a document, and ask.

## Commands

| Command        | What it does                                                 |
| -------------- | ------------------------------------------------------------ |
| `make install` | First-time setup: `.env` and backend venv                    |
| `make start`   | Run everything with Docker Compose (Ctrl+C stops it)         |
| `make stop`    | Stop all containers, data is kept                            |
| `make test`    | Run the backend tests                                        |
| `make url`     | Print frontend, Swagger UI, API, LangSmith and Postgres URLs |

To wipe the database (needed after changing `db/init.sql`): `docker compose down -v`.

## Configuration

All settings live in `.env` (see `.env.example`).

| Variable             | Default    | Notes                                             |
| -------------------- | ---------- | ------------------------------------------------- |
| `POSTGRES_DB`        | `postgres` |                                                   |
| `POSTGRES_USER`      | `postgres` |                                                   |
| `POSTGRES_PASSWORD`  | `postgres` |                                                   |
| `POSTGRES_PORT`      | `5432`     | Host port                                         |
| `BACKEND_PORT`       | `5001`     | Host port                                         |
| `FRONTEND_PORT`      | `5173`     | Host port                                         |
| `SECRET_KEY`         | —          | Signs login tokens (valid 24h)                    |
| `LLM_PROVIDER`       | `glm`      | `claude` \| `deepseek` \| `glm`                   |
| `LLM_MODEL`          | empty      | Empty uses the provider default                   |
| `LLM_API_KEY`        | —          | Key for the chosen provider                       |
| `LANGSMITH_TRACING`  | `false`    | `true` sends traces to LangSmith                  |
| `LANGSMITH_API_KEY`  | empty      | From smith.langchain.com                          |
| `LANGSMITH_PROJECT`  | `askbase`  | Dashboard project name                            |
| `LANGSMITH_ENDPOINT` | US server  | EU accounts: `https://eu.api.smith.langchain.com` |

Provider defaults: `claude-opus-5-5`, `deepseek-flash`, `glm-4.7-flash`.

## API

Swagger UI is at http://127.0.0.1:5001/docs. All routes except auth need `Authorization: Bearer <token>`.

| Method | Path                | Body                                          |
| ------ | ------------------- | --------------------------------------------- |
| POST   | `/auth/register`    | `{email, password}`                           |
| POST   | `/auth/login`       | `{email, password}` → `{token}`               |
| POST   | `/documents/text`   | `{title, text}`                               |
| POST   | `/documents/upload` | multipart `file` (`.pdf` / `.md`, max 10 MB)  |
| POST   | `/ask`              | `{question, history?, mode?}` → NDJSON stream |

`history` is the chat so far, oldest first: `[{role: "human" | "ai", content}]`, at most 20 turns. The browser keeps it, so "New chat" (or a page reload) starts with an empty one. `mode` is the search type (default `similarity`).

`/ask` streams one JSON object per line (`application/x-ndjson`):

```
{"type": "token", "text": "You worked "}      ← repeated, pieces of the answer
{"type": "done", "sources": [{n, title, content}, ...]}   ← only the passages the answer cited
{"type": "error", "message": "..."}           ← instead of "done" if the LLM fails mid-answer
```

Errors before the answer starts (bad key, rate limit, validation) are normal HTTP errors.

Scanned PDFs have no text layer and are rejected (no OCR).

## Project layout

```
backend/
  app.py        routes, auth, file upload
  rag.py        chunking, embeddings, search modes, LangChain prompts and streaming
  test_rag.py   tests
db/init.sql     schema (runs once, on an empty volume)
frontend/       React app; /api is proxied to the backend by Vite
```
