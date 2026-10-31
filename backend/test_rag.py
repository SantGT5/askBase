"""Run: python test_rag.py"""
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

import rag
from rag import DECLINED, chunk_text

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


# --- answering (prompt | model chain), with a fake model instead of a real API ---
def ask_with(message):
    rag.llm = lambda: GenericFakeChatModel(messages=iter([message]))
    return rag.ask_llm("[1] cv\nI worked at Acme", "Where did I work?")


assert ask_with(AIMessage("You worked at Acme [1].")) == "You worked at Acme [1]."
assert ask_with(AIMessage("", response_metadata={"stop_reason": "refusal"})) == DECLINED  # Claude
assert ask_with(AIMessage("", response_metadata={"finish_reason": "content_filter"})) == DECLINED  # OpenAI format
assert ask_with(AIMessage("", response_metadata={"finish_reason": "sensitive"})) == DECLINED  # GLM

messages = rag.PROMPT.invoke({"context": "CTX", "question": "Q", "history": []}).to_messages()
assert [m.type for m in messages] == ["system", "human"]
assert "CTX" in messages[1].content and messages[1].content.endswith("Question: Q")


# --- chat memory: follow-ups are rewritten for search, and the history reaches the answer prompt ---
class RecordingModel(GenericFakeChatModel):
    def _generate(self, messages, *args, **kwargs):
        prompts.append(messages)
        return super()._generate(messages, *args, **kwargs)


def answer_with(replies, history):
    prompts.clear()
    searched.clear()
    model = RecordingModel(messages=iter(AIMessage(r) for r in replies))  # one model, so replies come in order
    rag.llm = lambda: model
    return rag.answer(7, "And my role there?", history)


prompts, searched = [], []
rag.retrieve = lambda user_id, question: searched.append(question) or [("cv", "Engineer at Acme")]
history = [{"role": "human", "content": "Where did I work?"}, {"role": "ai", "content": "At Acme [1]."}]

result = answer_with(["What was my role at Acme?", "You were an engineer [1]."], history)
assert result["answer"] == "You were an engineer [1]."
assert searched == ["What was my role at Acme?"]  # retrieval used the standalone question, not "there"
assert [m.type for m in prompts[1]] == ["system", "human", "ai", "human"]  # the earlier turns came along
assert prompts[1][1].content == "Where did I work?" and prompts[1][3].content.endswith("Question: And my role there?")

answer_with(["You were an engineer [1]."], [])
assert len(prompts) == 1 and searched == ["And my role there?"]  # first question of a chat: no rewrite call

answer_with(["", "Engineer [1]."], history)
assert searched == ["And my role there?"]  # an empty rewrite falls back to the original wording
print("ok")
