"""Run: python test_rag.py"""
from rag import chunk_text

assert chunk_text("") == [""]
assert chunk_text("  short  ") == ["short"]
assert chunk_text("a" * 1000) == ["a" * 1000]

text = "".join(str(i % 10) for i in range(2500))
chunks = chunk_text(text)
assert all(len(c) <= 1000 for c in chunks)
assert chunks[0][-200:] == chunks[1][:200]  # neighbours overlap so a sentence on the boundary isn't lost
assert chunks[-1].endswith(text[-200:])  # nothing dropped at the end
print("ok")
