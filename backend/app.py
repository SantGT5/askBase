"""HTTP API. Run: flask --app app run (from backend/). Swagger UI at /docs."""
import os

import anthropic
import openai
import psycopg
from apiflask import APIFlask, HTTPTokenAuth, Schema, abort
from apiflask.fields import File, Integer, List, Nested, String
from apiflask.validators import Email, Length, OneOf
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pypdf import PdfReader
from pypdf.errors import PyPdfError
from werkzeug.security import check_password_hash, generate_password_hash

import rag

TOKEN_MAX_AGE = 24 * 3600  # seconds

app = APIFlask(__name__, title="askBase API", version="0.1.0")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY")
if app.config["SECRET_KEY"] in (None, "", "change-me"):  # an empty or public key would let anyone forge login tokens
    raise RuntimeError("SECRET_KEY is not set in .env")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # upload limit

auth = HTTPTokenAuth(scheme="Bearer")
tokens = URLSafeTimedSerializer(app.config["SECRET_KEY"])


@auth.verify_token
def verify_token(token):
    try:
        return {"id": tokens.loads(token, max_age=TOKEN_MAX_AGE)}
    except BadSignature:  # also covers expired tokens
        return None


class Credentials(Schema):
    email = String(required=True, validate=Email())
    password = String(required=True, validate=Length(min=8))


class Message(Schema):
    message = String()


class Token(Schema):
    token = String()


class TextIn(Schema):
    title = String(required=True, validate=Length(1, 200))
    text = String(required=True, validate=Length(min=1))


class UploadIn(Schema):
    file = File(required=True, metadata={"description": ".pdf or .md"})


class DocumentOut(Schema):
    id = Integer()
    title = String()
    chunks = Integer()


class Turn(Schema):
    role = String(required=True, validate=OneOf(["human", "ai"]))
    content = String(required=True, validate=Length(max=20000))


class AskIn(Schema):
    question = String(required=True, validate=Length(1, 2000))
    # The chat so far, oldest first. The browser holds it, so "New chat" is just sending an empty list.
    # Capped because every turn is re-sent to the paid LLM on each question.
    history = List(Nested(Turn), load_default=[], validate=Length(max=20))


class Source(Schema):
    n = Integer()
    title = String()
    content = String()


class AskOut(Schema):
    answer = String()
    sources = List(Nested(Source))


@app.post("/auth/register")
@app.input(Credentials)
@app.output(Message, status_code=201)
def register(json_data):
    try:
        with rag.connect() as conn:
            conn.execute(
                "INSERT INTO users (email, password_hash) VALUES (%s, %s)",
                (json_data["email"].lower(), generate_password_hash(json_data["password"])),
            )
    except psycopg.errors.UniqueViolation:
        abort(409, "Email already registered")
    return {"message": "Registered, now log in"}


@app.post("/auth/login")
@app.input(Credentials)
@app.output(Token)
def login(json_data):
    with rag.connect() as conn:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE email = %s", (json_data["email"].lower(),)
        ).fetchone()
    if not row or not check_password_hash(row[1], json_data["password"]):
        abort(401, "Invalid email or password")
    return {"token": tokens.dumps(row[0])}


@app.post("/documents/text")
@app.auth_required(auth)
@app.input(TextIn)
@app.output(DocumentOut, status_code=201)
def add_text(json_data):
    if not json_data["text"].strip():
        abort(400, "Text is empty")
    return rag.add_document(auth.current_user["id"], json_data["title"], json_data["text"], "text")


@app.post("/documents/upload")
@app.auth_required(auth)
@app.input(UploadIn, location="files")
@app.output(DocumentOut, status_code=201)
def upload(files_data):
    file = files_data["file"]
    ext = os.path.splitext(file.filename or "")[1].lower()
    try:
        if ext == ".pdf":
            text = "\n".join(page.extract_text() or "" for page in PdfReader(file.stream).pages)
        elif ext == ".md":
            text = file.read().decode("utf-8")
        else:
            abort(400, "Only .pdf and .md files are supported")
    except (PyPdfError, UnicodeDecodeError):
        abort(400, "Could not read the file")
    if not text.strip():
        abort(400, "No text found in the file (scanned PDFs need OCR)")
    return rag.add_document(auth.current_user["id"], file.filename, text, ext[1:])


@app.post("/ask")
@app.auth_required(auth)
@app.input(AskIn)
@app.output(AskOut)
def ask(json_data):
    if not os.environ.get("LLM_API_KEY"):
        abort(503, f"LLM_API_KEY is not set in .env (LLM_PROVIDER={rag.LLM_PROVIDER})")
    try:
        return rag.answer(auth.current_user["id"], json_data["question"], json_data["history"])
    except (anthropic.APIError, openai.APIError) as e:  # both SDKs already retried rate limits and 5xx
        abort(502, f"{rag.LLM_PROVIDER} API error: {e}")
