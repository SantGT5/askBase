"""The RAG pipeline. Ingest: chunk -> embed -> store.
Ask: (follow-up? rewrite it as a standalone question) -> search (similarity | multi_query | hybrid)
     -> LLM streams {answer, cited} with the chat history."""
import os
from functools import cache

import psycopg
from fastembed import TextEmbedding
from langchain_anthropic import ChatAnthropic
from langchain_core.exceptions import OutputParserException
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_openai import ChatOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pgvector.psycopg import register_vector
from typing_extensions import Annotated, TypedDict  # typing.TypedDict can't become a JSON schema on Python < 3.12

EMBED_MODEL = "BAAI/bge-small-en-v1.5"  # 384 dims, must match vector(384) in db/init.sql
TOP_K = 5

# The LLM that writes answers, picked in .env (LLM_PROVIDER, LLM_MODEL, LLM_API_KEY).
# base_url None means the Anthropic SDK; the others speak the OpenAI chat format.
# "structured" is how each provider is asked for JSON. GLM only streams it word by word with json_schema
# (with function_calling it sends the whole answer at once); tool calling is the widest-supported option elsewhere.
PROVIDERS = {
    "claude": {"base_url": None, "model": "claude-opus-5-5", "structured": "function_calling"},
    "deepseek": {"base_url": "https://api.deepseek.com", "model": "deepseek-flash", "structured": "function_calling"},
    "glm": {"base_url": "https://api.z.ai/api/paas/v4", "model": "glm-4.7-flash", "structured": "json_schema"},  # free tier
}
LLM_PROVIDER = os.environ.get("LLM_PROVIDER") or "glm"
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
    "If the passages do not contain the answer, say you don't know. "
    "Write plain text without Markdown, since the app shows it as-is."
)

# {context} and {question} are filled in per request; "history" is the earlier turns of the chat, inserted as real messages
PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", SYSTEM_PROMPT),
        MessagesPlaceholder("history"),
        ("human", "<context>\n{context}\n</context>\n\nQuestion: {question}"),
    ]
)

# "And what was my role there?" has nothing to search with, so follow-ups are rewritten before retrieval
REWRITE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Rewrite the user's last question as a standalone question that can be understood without the chat history. "
            "Keep it in the first person. Return only the rewritten question, or the question unchanged if it already stands alone.",
        ),
        MessagesPlaceholder("history"),
        ("human", "{question}"),
    ]
)

QUERIES_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You help search a person's own documents (CV, notes, records). Write 3 search queries for the question, "
            "each worded differently (synonyms, related terms, more specific or more general) to find passages one wording would miss.",
        ),
        ("human", "{question}"),
    ]
)

DECLINED = "The model declined to answer this question."
NO_DOCUMENTS = "You have no documents yet. Add some first."
SEARCH_MODES = ("similarity", "multi_query", "hybrid")
RRF_K = 60  # standard reciprocal rank fusion constant: dampens the gap between rank 1 and rank 2


# Structured output: the model must return JSON in these shapes. The docstring and descriptions are part of the
# schema the model sees, so they act as instructions. "answer" comes first so it streams before "cited".
class CitedAnswer(TypedDict):
    """The answer to the question and the passages it used."""

    answer: Annotated[str, ..., "The answer in the second person, citing passages like [1]"]
    cited: Annotated[list[int], ..., "Numbers of the context passages the answer actually used, e.g. [1, 3]"]


class SearchQueries(TypedDict):
    """Search queries for the question."""

    queries: Annotated[list[str], ..., "3 differently worded search queries"]


# Tries paragraphs, then lines, then words, so chunks rarely cut a sentence in half
SPLITTER = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)


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
    """One LangChain chat model whatever the provider, so the rest of the code doesn't care which it is."""
    api_key = os.environ["LLM_API_KEY"]
    base_url = PROVIDERS[LLM_PROVIDER]["base_url"]
    if base_url is None:
        # model_kwargs go straight into the Anthropic request
        fallback = (
            {"betas": ["server-side-fallback-2026-07-01"], "model_kwargs": {"fallbacks": "default"}}
            if LLM_MODEL in CLAUDE_FALLBACK_MODELS
            else {}
        )
        return ChatAnthropic(model=LLM_MODEL, api_key=api_key, max_tokens=16000, **fallback)
    return ChatOpenAI(model=LLM_MODEL, api_key=api_key, base_url=base_url)


def structured(schema):
    """The model, but it returns a dict matching the schema instead of a message (streams as a growing dict)."""
    return llm().with_structured_output(schema, method=PROVIDERS[LLM_PROVIDER]["structured"])


def chunk_text(text):
    return SPLITTER.split_text(text)


def add_document(user_id, title, text, source):
    chunks = chunk_text(text)
    vectors = list(embedder().embed(chunks))  # embed() is lazy: finish it before the transaction opens
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


def vector_search(user_id, query):
    query_vector = next(embedder().query_embed(query))
    with connect() as conn:
        # <=> is cosine distance: smaller means closer in meaning
        return conn.execute(
            """SELECT c.id, d.title, c.content FROM chunks c
               JOIN documents d ON d.id = c.document_id
               WHERE d.user_id = %s
               ORDER BY c.embedding <=> %s LIMIT %s""",
            (user_id, query_vector, TOP_K),
        ).fetchall()


def text_search(user_id, query):
    """Keyword search with Postgres full-text search: catches exact names, dates and IDs that embeddings blur."""
    # 'simple' = no stemming or stop words, so it works for any language. plainto_tsquery ANDs the words;
    # swapping & for | means a chunk matches on any of them, and ts_rank puts chunks with more matches first.
    # shortcut: to_tsvector runs on every row per search, add a generated tsvector column + GIN index past ~100k chunks
    with connect() as conn:
        return conn.execute(
            """SELECT c.id, d.title, c.content
               FROM chunks c JOIN documents d ON d.id = c.document_id,
                    to_tsquery('simple', replace(plainto_tsquery('simple', %s)::text, '&', '|')) q
               WHERE d.user_id = %s AND to_tsvector('simple', c.content) @@ q
               ORDER BY ts_rank(to_tsvector('simple', c.content), q) DESC LIMIT %s""",
            (query, user_id, TOP_K),
        ).fetchall()


def fuse(*rankings):
    """Reciprocal rank fusion: merges ranked lists of (id, title, content) rows into one top-K list of (title, content).
    A chunk scores 1/(RRF_K + rank) in every list it appears in, so chunks found by several searches rise to the top."""
    scores, rows = {}, {}
    for ranking in rankings:
        for rank, row in enumerate(ranking):
            scores[row[0]] = scores.get(row[0], 0) + 1 / (RRF_K + rank)
            rows[row[0]] = row
    return [rows[i][1:] for i in sorted(scores, key=scores.get, reverse=True)[:TOP_K]]


def search_queries(question):
    try:
        queries = (QUERIES_PROMPT | structured(SearchQueries)).invoke({"question": question})["queries"]
    except (OutputParserException, KeyError, TypeError):  # malformed JSON from the model: search with the question alone
        return [question]
    return [question, *[q for q in queries if isinstance(q, str) and q.strip()][:3]]


def retrieve(user_id, question, mode="similarity"):
    if mode == "multi_query":
        return fuse(*(vector_search(user_id, q) for q in search_queries(question)))
    if mode == "hybrid":
        return fuse(vector_search(user_id, question), text_search(user_id, question))
    return fuse(vector_search(user_id, question))


def standalone_question(question, history):
    if not history:
        return question
    rewritten = (REWRITE_PROMPT | llm()).invoke({"history": history, "question": question}).text.strip()
    return rewritten or question  # empty (e.g. a refusal): search with the original wording


def answer_stream(user_id, question, history=(), mode="similarity"):
    """Rewrites and searches right away (so their errors happen before the response starts),
    then returns a generator of events for the answer:
    {"type": "token", "text": ...} as the answer is written, then {"type": "done", "sources": [only the cited ones]}.
    history: earlier turns, oldest first, as [{"role": "human" | "ai", "content": "..."}]."""
    history = [(turn["role"], turn["content"]) for turn in history]  # LangChain reads (role, text) tuples as messages
    search = standalone_question(question, history)
    sources = [{"n": n, "title": title, "content": content} for n, (title, content) in enumerate(retrieve(user_id, search, mode), 1)]
    return stream_answer(question, history, sources)


def stream_answer(question, history, sources):
    if not sources:
        yield {"type": "token", "text": NO_DOCUMENTS}
        yield {"type": "done", "sources": []}
        return

    context = "\n\n".join(f"[{s['n']}] {s['title']}\n{s['content']}" for s in sources)
    chain = PROMPT | structured(CitedAnswer)  # LCEL: prompt -> model -> JSON parser, all in one runnable
    written, cited = "", []
    try:
        # .stream() yields the dict as it grows: {"answer": "You"}, {"answer": "You worked"}, ..., then "cited" appears
        for part in chain.stream({"context": context, "question": question, "history": history}):
            text = part.get("answer")
            if isinstance(text, str) and text.startswith(written) and len(text) > len(written):
                yield {"type": "token", "text": text[len(written) :]}  # send only what's new
                written = text
            cited = part.get("cited", cited)
    except OutputParserException:  # the model stopped sending valid JSON (e.g. a refusal); keep what was written
        pass
    # A refusal or content filter comes back with no answer at all.
    # shortcut: a refusal halfway through leaves the partial answer shown, check the stop reason if that happens
    if not written:
        yield {"type": "token", "text": DECLINED}
    cited = cited if isinstance(cited, list) else []
    yield {"type": "done", "sources": [s for s in sources if s["n"] in cited]}
