import { expect, test } from "@playwright/test"

import { HomePage } from "../../pages/home-page"

// The toggle lives in the header, so it works without logging in.
test.describe("Theme", () => {
  let home: HomePage

  test.beforeEach(async ({ page }) => {
    home = new HomePage(page)
    await page.goto("/")
  })

  test("dark and light apply to the page and survive a reload", async ({ page }) => {
    const html = page.locator("html")

    await home.setTheme("Dark")
    await expect(html).toHaveClass("dark")

    await page.reload()
    await expect(html).toHaveClass("dark")

    await home.setTheme("Light")
    await expect(html).toHaveClass("light")
  })

  test("system follows the OS color scheme live", async ({ page }) => {
    const html = page.locator("html")

    await home.setTheme("System")
    await page.emulateMedia({ colorScheme: "dark" })
    await expect(html).toHaveClass("dark")

    await page.emulateMedia({ colorScheme: "light" })
    await expect(html).toHaveClass("light")
  })

  test("the menu shows the current choice", async ({ page }) => {
    await home.setTheme("Dark")
    await home.themeButton().click()

    await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeChecked()
    await expect(page.getByRole("menuitemradio", { name: "Light" })).not.toBeChecked()
  })
})
