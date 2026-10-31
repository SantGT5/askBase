import { expect, test } from "../../fixtures"
import { AuthPage } from "../../pages/auth-page"
import { HomePage } from "../../pages/home-page"

test("an invalid or expired token sends the user back to login", async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.setItem("token", "not-a-real-token"))
  await page.reload()
  const home = new HomePage(page)

  // The UI trusts the stored token until the backend rejects it (real 401, nothing mocked)
  await home.addText("Doc", "Some text")

  await expect(new AuthPage(page).email()).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull()
})
