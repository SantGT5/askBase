import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, getToken, post, postStream, setToken } from "@/lib/api"

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status })
    )

  vi.stubGlobal("fetch", fetchMock)

  return fetchMock
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe("token storage", () => {
  it("stores, reads and clears the token", () => {
    expect(getToken()).toBeNull()
    setToken("abc")
    expect(getToken()).toBe("abc")
    setToken(null)
    expect(getToken()).toBeNull()
  })
})

describe("post", () => {
  it("sends JSON to /api with no auth header when logged out", async () => {
    const fetchMock = mockFetch(200, { ok: 1 })

    await expect(post("/ask", { question: "hi" })).resolves.toEqual({ ok: 1 })

    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe("/api/ask")
    expect(init.method).toBe("POST")
    expect(init.body).toBe('{"question":"hi"}')
    expect(init.headers).toEqual({ "Content-Type": "application/json" })
  })

  it("adds the bearer token when logged in", async () => {
    setToken("abc")
    const fetchMock = mockFetch(200, {})

    await post("/ask", {})

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer abc")
  })

  it("sends FormData as-is so the browser sets the multipart boundary", async () => {
    const fetchMock = mockFetch(201, {})
    const form = new FormData()

    await post("/documents/upload", form)

    const init = fetchMock.mock.calls[0][1]

    expect(init.body).toBe(form)
    expect(init.headers).not.toHaveProperty("Content-Type")
  })

  it("throws ApiError with the server message", async () => {
    mockFetch(401, { message: "Invalid email or password" })

    const err = (await post("/auth/login", {}).catch(e => e)) as ApiError

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    expect(err.message).toBe("Invalid email or password")
  })

  it("flattens field validation errors", async () => {
    mockFetch(422, {
      message: "Validation error",
      detail: { json: { email: ["Not a valid email."], password: ["Too short.", "Weak."] } },
    })

    await expect(post("/auth/register", {})).rejects.toThrow(
      "email: Not a valid email.; password: Too short. Weak."
    )
  })

  it("flattens file validation errors", async () => {
    mockFetch(422, { detail: { files: { file: ["Missing data."] } } })

    await expect(post("/documents/upload", new FormData())).rejects.toThrow("file: Missing data.")
  })

  it("falls back to the status code when the body is not JSON", async () => {
    mockFetch(502, "<html>Bad gateway</html>")

    await expect(post("/ask", {})).rejects.toThrow("Request failed (502)")
  })
})

describe("postStream", () => {
  // A body that arrives in the given pieces, like a slow network would deliver it
  function mockStream(pieces: string[]) {
    const body = new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }))

    vi.stubGlobal("fetch", fetchMock)

    return fetchMock
  }

  it("calls onEvent once per JSON line, even when lines are split across pieces", async () => {
    const fetchMock = mockStream([
      '{"type":"token","te',
      'xt":"Hi"}\n{"type":"to',
      'ken","text":"!"}\n\n',
      '{"type":"done"}',
    ])
    const events: unknown[] = []

    await postStream("/ask", { question: "q" }, e => events.push(e))

    expect(events).toEqual([
      { type: "token", text: "Hi" },
      { type: "token", text: "!" },
      { type: "done" }, // last line without a trailing newline still counts
    ])
    expect(fetchMock.mock.calls[0][1].body).toBe('{"question":"q"}')
  })

  it("throws ApiError with the server message before the stream starts", async () => {
    mockFetch(502, { message: "glm API error: bad key" })

    const err = (await postStream("/ask", {}, () => {}).catch(e => e)) as ApiError

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(502)
    expect(err.message).toBe("glm API error: bad key")
  })

  it("stops with the error thrown by onEvent", async () => {
    mockStream(['{"type":"error","message":"boom"}\n{"type":"token","text":"never"}\n'])
    const seen: unknown[] = []

    await expect(
      postStream<{ type: string }>("/ask", {}, e => {
        seen.push(e)
        if (e.type === "error") throw new Error("boom")
      })
    ).rejects.toThrow("boom")
    expect(seen).toHaveLength(1)
  })
})
