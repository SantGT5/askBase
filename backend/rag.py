"""The RAG pipeline. Ingest: chunk -> embed -> store. Ask: embed question -> nearest chunks -> LLM."""
import os
from functools import cache

import anthropic
import openai
import psycopg
from fastembed import TextEmbedding
from pgvector.psycopg import register_vector

EMBED_MODEL = "BAAI/bge-small-en-v1.5"  # 384 dims, must match vector(384) in db/init.sql
TOP_K = 5

# The LLM that writes answers, picked in .env (LLM_PROVIDER, LLM_MODEL, LLM_API_KEY).
# base_url None means the Anthropic SDK; the others speak the OpenAI chat format.
PROVIDERS = {
    "claude": {"base_url": None, "model": "claude-opus-5-5"},
    "deepseek": {"base_url": "https://api.deepseek.com", "model": "deepseek-flash"},
    "glm": {"base_url": "https://api.z.ai/api/paas/v4", "model": "glm-4.7-flash"},  # free tier
}
LLM_PROVIDER = os.environ.get("LLM_PROVIDER") or "claude"
if LLM_PROVIDER not in PROVIDERS:
    raise RuntimeError(f"LLM_PROVIDER must be one of {', '.join(PROVIDERS)}, got {LLM_PROVIDER!r}")
LLM_MODEL = os.environ.get("LLM_MODEL") or PROVIDERS[LLM_PROVIDER]["model"]

# Claude models that accept fallbacks="default" (re-run a refused request on another model)
CLAUDE_FALLBACK_MODELS = ("claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5")

SYSTEM_PROMPT = (
    "The numbered context passages come from the user's own personal documents (CV, notes, records). "
    'The person asking is that user: "I", "me" and "my" in the question mean them. '
    'Answer in the second person ("you worked at..."), using only the numbered context passages. '
    "Cite the passages you used like [1]. "
    "This is the user's own information, so share personal details such as dates, addresses or numbers directly. "
    "If the passages do not contain the answer, say you don't know."
)
DECLINED = "The model declined to answer this question."


def connect():
    # shortcut: new connection per call, switch to psycopg_pool if requests get slow
    conn = psycopg.connect(os.environ["DATABASE_URL"])
    register_vector(conn)
    return conn


@cache
def embedder():
    return TextEmbedding(EMBED_MODEL)  # downloads the model on first use


@cache
def llm():
    base_url = PROVIDERS[LLM_PROVIDER]["base_url"]
    if base_url is None:
        return anthropic.Anthropic(api_key=os.environ["LLM_API_KEY"])
    return openai.OpenAI(api_key=os.environ["LLM_API_KEY"], base_url=base_url)


def chunk_text(text, size=1000, overlap=200):
    # shortcut: fixed character windows can cut mid-sentence, split on paragraphs/headings if answers miss context
    text = text.strip()
    return [text[i : i + size] for i in range(0, max(len(text) - overlap, 1), size - overlap)]


def add_document(user_id, title, text, source):
    chunks = chunk_text(text)
    vectors = embedder().embed(chunks)
    with connect() as conn:
        doc_id = conn.execute(
            "INSERT INTO documents (user_id, title, source) VALUES (%s, %s, %s) RETURNING id",
            (user_id, title, source),
        ).fetchone()[0]
        conn.cursor().executemany(
            "INSERT INTO chunks (document_id, content, embedding) VALUES (%s, %s, %s)",
            [(doc_id, chunk, vector) for chunk, vector in zip(chunks, vectors)],
        )
    return {"id": doc_id, "title": title, "chunks": len(chunks)}


def retrieve(user_id, question):
    question_vector = next(embedder().query_embed(question))
    with connect() as conn:
        # <=> is cosine distance: smaller means closer in meaning
        return conn.execute(
            """SELECT d.title, c.content FROM chunks c
               JOIN documents d ON d.id = c.document_id
               WHERE d.user_id = %s
               ORDER BY c.embedding <=> %s LIMIT %s""",
            (user_id, question_vector, TOP_K),
        ).fetchall()


def ask_claude(prompt):
    fallback = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"} if LLM_MODEL in CLAUDE_FALLBACK_MODELS else {}
    response = llm().beta.messages.create(
        model=LLM_MODEL,
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
        **fallback,
    )
    if response.stop_reason == "refusal":
        return DECLINED
    return "".join(block.text for block in response.content if block.type == "text")


def ask_openai_format(prompt):
    choice = llm().chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
    ).choices[0]
    if choice.finish_reason in ("content_filter", "sensitive"):  # "sensitive" is GLM's name for it
        return DECLINED
    return choice.message.content or ""


def answer(user_id, question):
    sources = [{"n": n, "title": title, "content": content} for n, (title, content) in enumerate(retrieve(user_id, question), 1)]
    if not sources:
        return {"answer": "You have no documents yet. Add some first.", "sources": []}

    context = "\n\n".join(f"[{s['n']}] {s['title']}\n{s['content']}" for s in sources)
    prompt = f"<context>\n{context}\n</context>\n\nQuestion: {question}"
    text = ask_claude(prompt) if LLM_PROVIDER == "claude" else ask_openai_format(prompt)
    return {"answer": text, "sources": sources}
