import { expect, test } from "../../fixtures"
import { AuthPage } from "../../pages/auth-page"

test.describe("Register", () => {
  let auth: AuthPage

  test.beforeEach(async ({ page }) => {
    auth = new AuthPage(page)
    await auth.goto()
  })

  test("switching tabs changes the form", async ({ page }) => {
    await expect(auth.heading()).toHaveText("Welcome back")
    await expect(auth.password()).toHaveAttribute("autocomplete", "current-password")

    await page.getByRole("tab", { name: "Register" }).click()

    await expect(auth.heading()).toHaveText("Create an account")
    await expect(auth.password()).toHaveAttribute("autocomplete", "new-password")
  })

  test("registers a new account and logs straight in", async () => {
    await auth.register(`e2e-new-${Date.now()}@example.com`, "password123")

    await expect(auth.logoutButton()).toBeVisible()
  })

  test("rejects an email that is already registered", async ({ user }) => {
    await auth.register(user.email, user.password)

    await expect(auth.error()).toHaveText("Email already registered")
    await expect(auth.logoutButton()).toBeHidden()
  })

  test("browser blocks a password shorter than 8 characters", async ({ page }) => {
    let calledApi = false

    page.on("request", r => {
      if (r.url().includes("/api/auth/")) calledApi = true
    })

    await auth.register(`e2e-short-${Date.now()}@example.com`, "short")

    expect(await auth.password().evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(
      true
    )
    expect(calledApi).toBe(false)
  })
})
