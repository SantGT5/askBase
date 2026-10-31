import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, getToken, post, setToken } from "@/lib/api"

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
