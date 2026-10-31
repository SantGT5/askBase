import { expect, test } from "../../fixtures"
import { AuthPage } from "../../pages/auth-page"

test.describe("Login", () => {
  let auth: AuthPage

  test.beforeEach(async ({ page }) => {
    auth = new AuthPage(page)
    await auth.goto()
  })

  test("logs in with valid credentials", async ({ page, user }) => {
    await auth.login(user.email, user.password)

    await expect(auth.logoutButton()).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem("token"))).toBeTruthy()
  })

  test("email is case-insensitive", async ({ user }) => {
    await auth.login(user.email.toUpperCase(), user.password)

    await expect(auth.logoutButton()).toBeVisible()
  })

  test("shows an error for a wrong password", async ({ user }) => {
    await auth.login(user.email, "wrong-password")

    await expect(auth.error()).toHaveText("Invalid email or password")
    await expect(auth.logoutButton()).toBeHidden()
  })

  test("shows an error for an unknown email", async () => {
    await auth.login(`nobody-${Date.now()}@example.com`, "password123")

    await expect(auth.error()).toHaveText("Invalid email or password")
  })

  test("stays logged in after reload", async ({ page, user }) => {
    await auth.login(user.email, user.password)
    await expect(auth.logoutButton()).toBeVisible()

    await page.reload()

    await expect(auth.logoutButton()).toBeVisible()
  })

  test("logs out back to the login screen", async ({ page, user }) => {
    await auth.login(user.email, user.password)
    await auth.logoutButton().click()

    await expect(auth.email()).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull()
  })
})
