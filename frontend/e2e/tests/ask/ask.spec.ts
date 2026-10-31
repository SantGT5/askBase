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

    expect(sent).toEqual({ question: "Where was I born?" })
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

  test("a 401 logs the user out", async ({ home, page }) => {
    await page.route("**/api/ask", route =>
      route.fulfill({ status: 401, json: { message: "Unauthorized" } })
    )

    await home.ask("Anything?")

    await expect(new AuthPage(page).email()).toBeVisible()
  })
})
