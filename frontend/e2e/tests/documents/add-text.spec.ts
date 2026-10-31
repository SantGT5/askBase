import { expect, test } from "../../fixtures"

// Real backend: text is chunked, embedded and stored in Postgres.
test.describe("Add context: text", () => {
  test("adds a short text as one chunk and clears the form", async ({ home }) => {
    await home.addText("My notes", "I was born in Lisbon.")

    await expect(home.addStatus()).toHaveText('Added "My notes" (1 chunk)')
    await expect(home.titleInput()).toHaveValue("")
    await expect(home.textInput()).toHaveValue("")
  })

  test("splits long text into several chunks", async ({ home }) => {
    await home.addText("Long doc", "word ".repeat(600)) // 3000 chars, chunks of 1000 with 200 overlap

    await expect(home.addStatus()).toHaveText('Added "Long doc" (4 chunks)')
  })

  test("rejects text that is only whitespace", async ({ home }) => {
    await home.addText("Blank", "   \n  ")

    await expect(home.addStatus()).toHaveText("Text is empty")
    await expect(home.titleInput()).toHaveValue("Blank") // kept so the user can fix it
  })

  test("drops NUL bytes instead of failing", async ({ home, page }) => {
    // A textarea can't hold NUL, so send it straight to the API with the logged-in token
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/documents/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ title: "N\u0000ul", text: "Hello\u0000 world" }),
      })

      return { status: r.status, body: await r.json() }
    })

    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.title).toBe("Nul")
    await expect(home.logoutButton()).toBeVisible()
  })

  test("switching tabs clears the status message", async ({ home, page }) => {
    await home.addText("Doc", "Hello")
    await expect(home.addStatus()).toBeVisible()

    await page.getByRole("tab", { name: "File" }).click()

    await expect(home.addStatus()).toBeHidden()
  })
})
