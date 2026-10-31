import type { APIRequestContext } from "@playwright/test"

import { expect, test } from "../../fixtures"

// Real backend and Postgres, no mocks: guards the WHERE user_id filter in the search SQL (backend/rag.py).
// The other user has no documents, so /ask answers without calling the LLM, but LLM_API_KEY must be set.

async function tokenFor(request: APIRequestContext, email: string, password = "password123") {
  await request.post("/api/auth/register", { data: { email, password } })
  const res = await request.post("/api/auth/login", { data: { email, password } })

  expect(res.ok(), await res.text()).toBe(true)

  return (await res.json()).token as string
}

test("a user never gets another user's documents", async ({ request, user }, testInfo) => {
  const owner = await tokenFor(request, user.email, user.password)
  const other = await tokenFor(request, `e2e-${testInfo.testId}-other-${Date.now()}@example.com`)

  const added = await request.post("/api/documents/text", {
    headers: { Authorization: `Bearer ${owner}` },
    data: { title: "Secret", text: "My locker code is zebra-4711." },
  })

  expect(added.status(), await added.text()).toBe(201)

  for (const mode of ["similarity", "hybrid"]) {
    const res = await request.post("/api/ask", {
      headers: { Authorization: `Bearer ${other}` },
      data: { question: "zebra-4711 locker code", mode },
    })

    expect(res.status(), await res.text()).toBe(200)
    const events = (await res.text())
      .trim()
      .split("\n")
      .map(line => JSON.parse(line))

    expect(events, mode).toEqual([
      { type: "token", text: "You have no documents yet. Add some first." },
      { type: "done", sources: [] },
    ])
  }
})
