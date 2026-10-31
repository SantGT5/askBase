import { expect, test } from "../../fixtures"
import { AuthPage } from "../../pages/auth-page"

// /api/ask calls a paid external LLM, so these tests mock that one endpoint.
// Auth and everything else still run against the real backend.

type Source = { n: number; title: string; content: string }
type Sent = { question: string; history: unknown[]; mode: string }

// What the backend streams: the answer in word-sized pieces, then the cited sources
function streamed(answer: string, sources: Source[] = []) {
  const events = [
    ...answer.split(/(?<= )/).map(text => ({ type: "token", text })),
    { type: "done", sources },
  ]

  return {
    contentType: "application/x-ndjson",
    body: events.map(e => JSON.stringify(e)).join("\n") + "\n",
  }
}

test.describe("Ask", () => {
  test("shows the streamed answer with its sources", async ({ home, page }) => {
    let sent: Sent | undefined

    await page.route("**/api/ask", async route => {
      sent = route.request().postDataJSON()
      await route.fulfill(
        streamed("You were born in Lisbon [1].", [
          { n: 1, title: "My notes", content: "I was born in Lisbon." },
          { n: 3, title: "CV", content: "Software engineer." },
        ])
      )
    })

    await home.ask("Where was I born?")

    expect(sent).toEqual({ question: "Where was I born?", history: [], mode: "similarity" })
    await expect(page.getByText("You were born in Lisbon [1].")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible()
    await expect(home.sources()).toHaveCount(2)
    await expect(home.sources().first()).toContainText("[1] My notes")
    await expect(home.sources().last()).toContainText("[3] CV") // numbers match the [n] citations
  })

  test("hides the sources section when nothing was cited", async ({ home, page }) => {
    await page.route("**/api/ask", route => route.fulfill(streamed("I don't know.")))

    await home.ask("What is my blood type?")

    await expect(page.getByText("I don't know.")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Sources" })).toBeHidden()
  })

  test("the input starts centered and moves to the bottom after the first question", async ({
    home,
    page,
  }) => {
    await page.route("**/api/ask", route => route.fulfill(streamed("Answer.")))
    const viewport = page.viewportSize()!

    await expect(home.emptyState()).toBeVisible()
    const before = (await home.questionInput().boundingBox())!

    expect(before.y).toBeLessThan(viewport.height * 0.75) // around the middle, not at the bottom

    await home.questionInput().fill("First question")
    await page.keyboard.press("Control+Enter")
    await expect(page.getByText("Answer.")).toBeVisible()
    await expect(home.emptyState()).toBeHidden()
    const after = (await home.questionInput().boundingBox())!

    expect(after.y).toBeGreaterThan(before.y)
    expect(after.y + after.height).toBeGreaterThan(viewport.height * 0.75)
    await expect(home.questionInput()).toBeFocused() // focus stays in the box when it moves
  })

  test("sends the chosen search type", async ({ home, page }) => {
    let sent: Sent | undefined

    await page.route("**/api/ask", async route => {
      sent = route.request().postDataJSON()
      await route.fulfill(streamed("Done."))
    })

    await expect(home.searchTypeButton()).toHaveAccessibleName("Search type: Similarity")
    await home.setSearchType("Hybrid")
    await expect(home.searchTypeButton()).toHaveAccessibleName("Search type: Hybrid")

    await home.ask("What was my employee ID?")
    await expect(page.getByText("Done.")).toBeVisible()
    expect(sent?.mode).toBe("hybrid")
  })

  test("shows the error when the LLM fails before answering", async ({ home, page }) => {
    await page.route("**/api/ask", route =>
      route.fulfill({ status: 502, json: { message: "glm API error: timeout" } })
    )

    await home.ask("Anything?")

    await expect(home.askError()).toHaveText("glm API error: timeout")
    await expect(home.askButton()).toBeEnabled()
    await expect(home.questionInput()).toHaveValue("Anything?") // kept so it can be retried
    await expect(home.emptyState()).toBeVisible() // the failed question is not left in the thread
  })

  test("shows the error when the LLM fails mid-answer", async ({ home, page }) => {
    await page.route("**/api/ask", route =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body:
          JSON.stringify({ type: "token", text: "You were " }) +
          "\n" +
          JSON.stringify({ type: "error", message: "glm API error: connection reset" }) +
          "\n",
      })
    )

    await home.ask("Anything?")

    await expect(home.askError()).toHaveText("glm API error: connection reset")
    await expect(page.getByText("You were")).toBeHidden()
    await expect(home.questionInput()).toHaveValue("Anything?")
  })

  test("treats a stream that ends without finishing as an error", async ({ home, page }) => {
    await page.route("**/api/ask", route =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body: JSON.stringify({ type: "token", text: "Half" }) + "\n",
      })
    )

    await home.ask("Anything?")

    await expect(home.askError()).toHaveText("The answer was cut off. Please try again.")
  })

  test("disables the button while waiting", async ({ home, page }) => {
    let release!: () => void
    const waiting = new Promise<void>(r => (release = r))

    await page.route("**/api/ask", async route => {
      await waiting
      await route.fulfill(streamed("Done."))
    })

    await home.ask("Slow question")
    await expect(home.askButton()).toBeDisabled()
    await expect(page.getByText("Searching your documents…")).toBeVisible()

    release()
    await expect(page.getByText("Done.")).toBeVisible()
    await expect(home.askButton()).toBeEnabled()
  })

  test("sends the earlier turns as history and keeps the thread", async ({ home, page }) => {
    const sent: Sent[] = []

    await page.route("**/api/ask", async route => {
      sent.push(route.request().postDataJSON())
      await route.fulfill(streamed(`Answer ${sent.length}.`))
    })

    await home.ask("Where did I work?")
    await expect(page.getByText("Answer 1.")).toBeVisible()
    await expect(home.questionInput()).toHaveValue("") // cleared once sent

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
    const sent: Sent[] = []

    await page.route("**/api/ask", async route => {
      sent.push(route.request().postDataJSON())
      await route.fulfill(streamed(`Answer ${sent.length}.`))
    })

    await expect(home.newChatButton()).toBeHidden() // nothing to clear yet
    await home.ask("First question")
    await expect(page.getByText("Answer 1.")).toBeVisible()

    await home.newChatButton().click()
    await expect(page.getByText("Answer 1.")).toBeHidden()
    await expect(page.getByText("First question")).toBeHidden()
    await expect(home.emptyState()).toBeVisible()

    await home.ask("Fresh start")
    await expect(page.getByText("Answer 2.")).toBeVisible()
    expect(sent[1].history).toEqual([])
  })

  test("the chat survives a visit to the Add context page", async ({ home, page }) => {
    await page.route("**/api/ask", route => route.fulfill(streamed("Kept answer.")))

    await home.ask("Remember me")
    await expect(page.getByText("Kept answer.")).toBeVisible()

    await home.addContextLink().click()
    await expect(page).toHaveURL(/#\/add$/)
    await expect(home.questionInput()).toBeHidden()

    await home.askLink().click()
    await expect(page.getByText("Kept answer.")).toBeVisible()
  })

  test("coming back from Add context lands at the bottom of a long chat", async ({
    home,
    page,
  }) => {
    await page.route("**/api/ask", route => route.fulfill(streamed("Long answer. ".repeat(200))))

    for (const n of [1, 2, 3]) {
      await home.ask(`Question ${n}`)
      await expect(page.getByText(`Question ${n}`)).toBeVisible()
      await expect(home.askButton()).toBeEnabled()
    }

    await home.addContextLink().click()
    await expect(home.titleInput()).toBeVisible()
    await home.askLink().click()
    await expect(home.questionInput()).toBeVisible() // the Ask page is back, so the page is long again

    const distanceToBottom = () =>
      page.evaluate(() => document.body.scrollHeight - window.innerHeight - window.scrollY)

    await expect.poll(distanceToBottom).toBeLessThan(2)
    await expect(page.getByText("Question 1")).not.toBeInViewport()
  })

  test("does not pull the user down while they read earlier answers", async ({ home, page }) => {
    let release!: () => void
    const waiting = new Promise<void>(r => (release = r))
    let calls = 0

    await page.route("**/api/ask", async route => {
      if (++calls === 3) await waiting
      await route.fulfill(streamed(`Answer ${calls}. ` + "More text. ".repeat(200)))
    })

    await home.ask("Question 1")
    await expect(home.askButton()).toBeEnabled()
    await home.ask("Question 2")
    await expect(home.askButton()).toBeEnabled()
    await home.ask("Question 3")
    await expect(page.getByText("Searching your documents…")).toBeVisible()

    // Scroll up to re-read the first answer. Not mouse.wheel: its smooth animation would hide a jump down.
    // Two frames let the scroll event fire before the answer arrives.
    await page.evaluate(() => {
      window.scrollTo(0, 0)

      return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    release()

    await expect(home.askButton()).toBeEnabled()
    await expect(page.getByText("Question 1")).toBeInViewport() // the answer arrived without moving the page
  })

  test("Enter adds a line and Ctrl+Enter sends a multi-line question", async ({ home, page }) => {
    let sent: Sent | undefined

    await page.route("**/api/ask", async route => {
      sent = route.request().postDataJSON()
      await route.fulfill(streamed("Got both lines."))
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
