-- Runs only on first start (empty volume). Changing it later needs `docker compose down -v` (wipes data).
-- shortcut: no migrations tool, add one (e.g. alembic) once there is data worth keeping.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
    id            bigserial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
    id         bigserial PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES users ON DELETE CASCADE,
    title      text NOT NULL,
    source     text NOT NULL, -- text | pdf | md
    created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per piece of a document. 384 = output size of the embedding model in backend/rag.py.
-- shortcut: no vector index, so search scans every row (exact, fine up to ~100k chunks); add HNSW past that.
CREATE TABLE chunks (
    id          bigserial PRIMARY KEY,
    document_id bigint NOT NULL REFERENCES documents ON DELETE CASCADE,
    content     text NOT NULL,
    embedding   vector(384) NOT NULL
);
