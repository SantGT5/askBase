import { expect, test } from "../../fixtures"
import { AuthPage } from "../../pages/auth-page"

// /api/ask calls a paid external LLM, so these tests mock that one endpoint.
// Auth and everything else still run against the real backend.
test.describe("Ask", () => {
  test("shows the answer with its sources", async ({ home, page }) => {
    let sent: unknown

    await page.route("**/api/ask", async route => {
      sent = route.request().postDataJSON()
      await route.fulfill({
        json: {
          answer: "You were born in Lisbon [1].",
          sources: [
            { n: 1, title: "My notes", content: "I was born in Lisbon." },
            { n: 2, title: "CV", content: "Software engineer." },
          ],
        },
      })
    })

    await home.ask("Where was I born?")

    expect(sent).toEqual({ question: "Where was I born?", history: [] })
    await expect(page.getByText("You were born in Lisbon [1].")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible()
    await expect(home.sources()).toHaveCount(2)
    await expect(home.sources().first()).toContainText("[1] My notes")
    await expect(home.sources().first()).toContainText("I was born in Lisbon.")
  })

  test("hides the sources section when there are none", async ({ home, page }) => {
    await page.route("**/api/ask", route =>
      route.fulfill({ json: { answer: "I don't know.", sources: [] } })
    )

    await home.ask("What is my blood type?")

    await expect(page.getByText("I don't know.")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Sources" })).toBeHidden()
  })

  test("shows the error when the LLM fails", async ({ home, page }) => {
    await page.route("**/api/ask", route =>
      route.fulfill({ status: 502, json: { message: "glm API error: timeout" } })
    )

    await home.ask("Anything?")

    await expect(home.askError()).toHaveText("glm API error: timeout")
    await expect(home.askButton()).toBeEnabled()
  })

  test("disables the button while waiting", async ({ home, page }) => {
    let release!: () => void
    const waiting = new Promise<void>(r => (release = r))

    await page.route("**/api/ask", async route => {
      await waiting
      await route.fulfill({ json: { answer: "Done.", sources: [] } })
    })

    await home.ask("Slow question")
    await expect(home.askButton()).toBeDisabled()

    release()
    await expect(page.getByText("Done.")).toBeVisible()
    await expect(home.askButton()).toBeEnabled()
  })

  test("sends the earlier turns as history and keeps the thread", async ({ home, page }) => {
    const sent: { question: string; history: unknown[] }[] = []

    await page.route("**/api/ask", async route => {
      sent.push(route.request().postDataJSON())
      await route.fulfill({ json: { answer: `Answer ${sent.length}.`, sources: [] } })
    })

    await home.ask("Where did I work?")
    await expect(page.getByText("Answer 1.")).toBeVisible()
    await expect(home.questionInput()).toHaveValue("") // cleared after a successful send

    await home.ask("And my role there?")
    await expect(page.getByText("Answer 2.")).toBeVisible()

    expect(sent[1].history).toEqual([
      { role: "human", content: "Where did I work?" },
      { role: "ai", content: "Answer 1." },
    ])
    await expect(page.getByText("Answer 1.")).toBeVisible() // the first exchange is still shown
    await expect(page.getByText("Where did I work?")).toBeVisible()
  })

  test("New chat clears the thread and the memory", async ({ home, page }) => {
    const sent: { history: unknown[] }[] = []

    await page.route("**/api/ask", async route => {
      sent.push(route.request().postDataJSON())
      await route.fulfill({ json: { answer: `Answer ${sent.length}.`, sources: [] } })
    })

    await expect(home.newChatButton()).toBeDisabled() // nothing to clear yet
    await home.ask("First question")
    await expect(page.getByText("Answer 1.")).toBeVisible()

    await home.newChatButton().click()
    await expect(page.getByText("Answer 1.")).toBeHidden()
    await expect(page.getByText("First question")).toBeHidden()
    await expect(home.newChatButton()).toBeDisabled()

    await home.ask("Fresh start")
    await expect(page.getByText("Answer 2.")).toBeVisible()
    expect(sent[1].history).toEqual([])
  })

  test("Enter adds a line and Ctrl+Enter sends a multi-line question", async ({ home, page }) => {
    let sent: { question: string } | undefined

    await page.route("**/api/ask", async route => {
      sent = route.request().postDataJSON()
      await route.fulfill({ json: { answer: "Got both lines.", sources: [] } })
    })

    await home.questionInput().click()
    await page.keyboard.type("First line")
    await page.keyboard.press("Enter")
    await page.keyboard.type("Second line")
    await expect(home.questionInput()).toHaveValue("First line\nSecond line")
    expect(sent).toBeUndefined() // plain Enter did not send

    await page.keyboard.press("Control+Enter")
    await expect(page.getByText("Got both lines.")).toBeVisible()
    expect(sent?.question).toBe("First line\nSecond line")
  })

  test("a 401 logs the user out", async ({ home, page }) => {
    await page.route("**/api/ask", route =>
      route.fulfill({ status: 401, json: { message: "Unauthorized" } })
    )

    await home.ask("Anything?")

    await expect(new AuthPage(page).email()).toBeVisible()
  })
})
