"""Run: python test_rag.py"""
from langchain_core.exceptions import OutputParserException
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableGenerator, RunnableLambda

import rag
from rag import DECLINED, NO_DOCUMENTS, chunk_text, fuse

# --- chunking (LangChain RecursiveCharacterTextSplitter) ---
assert chunk_text("") == []  # app.py rejects empty text before it gets here
assert chunk_text("  short  ") == ["short"]

paragraph = "word " * 150  # ~750 chars
chunks = chunk_text(f"{paragraph}\n\n{paragraph}")
assert len(chunks) == 2 and all(c == paragraph.strip() for c in chunks)  # split on the blank line, not mid-paragraph

text = "".join(str(i % 10) for i in range(2500))  # no spaces at all: falls back to cutting characters
chunks = chunk_text(text)
assert all(len(c) <= 1000 for c in chunks)
assert chunks[0][-200:] == chunks[1][:200]  # neighbours overlap so a sentence on the boundary isn't lost
assert chunks[-1].endswith(text[-200:])  # nothing dropped at the end


# --- reciprocal rank fusion ---
a, b, c, d = (1, "t", "A"), (2, "t", "B"), (3, "t", "C"), (4, "t", "D")
assert fuse([a, b, c]) == [("t", "A"), ("t", "B"), ("t", "C")]  # one list keeps its order
assert fuse([a, b, c], [c, d])[0] == ("t", "C")  # found by both searches beats rank 1 of only one
assert len(fuse([(i, "t", str(i)) for i in range(9)])) == rag.TOP_K
assert fuse() == []


# --- search modes, with fake searches instead of Postgres ---
calls = []
rag.vector_search = lambda user_id, q: calls.append(("vector", q)) or [(hash(q), "t", q)]
rag.text_search = lambda user_id, q: calls.append(("text", q)) or [(hash(q), "t", q)]
rag.structured = lambda schema: RunnableLambda(lambda _: {"queries": ["alt one", "alt two", "", 5, "alt three", "alt four"]})

calls.clear()
rag.retrieve(7, "Q")
assert calls == [("vector", "Q")]

calls.clear()
rag.retrieve(7, "Q", "hybrid")
assert calls == [("vector", "Q"), ("text", "Q")]

calls.clear()
rag.retrieve(7, "Q", "multi_query")
assert calls == [("vector", q) for q in ["Q", "alt one", "alt two", "alt three"]]  # junk dropped, capped at 3


def bad_json(_):
    raise OutputParserException("not json")


rag.structured = lambda schema: RunnableLambda(bad_json)
calls.clear()
rag.retrieve(7, "Q", "multi_query")
assert calls == [("vector", "Q")]  # malformed query list: falls back to the question alone


# --- streaming the answer: the fake model streams growing dicts like with_structured_output does ---
prompts, searched = [], []
SOURCES = [("cv", "Engineer at Acme"), ("notes", "Likes hiking"), ("cv", "Studied in Porto")]
rag.retrieve = lambda user_id, q, mode="similarity": searched.append((q, mode)) or SOURCES


def streams(*parts, fail=False):
    def generate(inputs):
        for prompt in inputs:
            prompts.append(prompt.to_messages())
        yield from parts
        if fail:
            raise OutputParserException("cut off")

    return lambda schema: RunnableGenerator(generate)


def run(history=(), mode="similarity", rewrite="And my role there?"):
    prompts.clear()
    searched.clear()
    rag.llm = lambda: GenericFakeChatModel(messages=iter([AIMessage(rewrite)]))
    events = list(rag.answer_stream(7, "And my role there?", history, mode))
    text = "".join(e["text"] for e in events if e["type"] == "token")
    return text, events[-1]


rag.structured = streams({"answer": "You"}, {"answer": "You were"}, {"answer": "You were an engineer [1]."},
                         {"answer": "You were an engineer [1].", "cited": [1]}, {"answer": "You were an engineer [1].", "cited": [1, 3]})
text, done = run()
assert text == "You were an engineer [1]."  # pieces add up to the full answer, nothing repeated
assert done == {"type": "done", "sources": [{"n": 1, "title": "cv", "content": "Engineer at Acme"},
                                            {"n": 3, "title": "cv", "content": "Studied in Porto"}]}  # only the cited ones
assert searched == [("And my role there?", "similarity")]

history = [{"role": "human", "content": "Where did I work?"}, {"role": "ai", "content": "At Acme [1]."}]
run(history, "hybrid", rewrite="What was my role at Acme?")
assert searched == [("What was my role at Acme?", "hybrid")]  # follow-up rewritten before searching, mode passed on
assert [m.type for m in prompts[0]] == ["system", "human", "ai", "human"]  # the earlier turns reached the answer prompt
assert prompts[0][3].content.endswith("Question: And my role there?")

run(history, rewrite="")
assert searched == [("And my role there?", "similarity")]  # an empty rewrite falls back to the original wording

rag.structured = streams({}, {"answer": ""})
assert run() == (DECLINED, {"type": "done", "sources": []})  # refusal / content filter: nothing written

rag.structured = streams({"answer": "You were"}, fail=True)
assert run() == ("You were", {"type": "done", "sources": []})  # broken JSON midway keeps what was written

rag.structured = streams({"answer": "Hi", "cited": [99, "1", [2]]})
assert run()[1]["sources"] == []  # cited numbers that aren't real passages are ignored

rag.retrieve = lambda user_id, q, mode="similarity": []
assert run() == (NO_DOCUMENTS, {"type": "done", "sources": []})
print("ok")
