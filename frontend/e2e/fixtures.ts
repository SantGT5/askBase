import { test as base, expect } from "@playwright/test"

import { HomePage } from "./pages/home-page"

export type User = { email: string; password: string }

type Fixtures = {
  user: User // freshly registered, not logged in
  home: HomePage // same user, already logged in on the main screen
}

export const test = base.extend<Fixtures>({
  // Each test gets its own user, so tests never share or collide on data.
  user: async ({ request }, use, testInfo) => {
    const user = {
      email: `e2e-${testInfo.testId}-${Date.now()}@example.com`,
      password: "password123",
    }
    const res = await request.post("/api/auth/register", { data: user })

    expect(res.status(), await res.text()).toBe(201)
    await use(user)
  },

  // Logs in through the API (the UI login is covered by auth/login.spec.ts)
  home: async ({ page, request, user }, use) => {
    const res = await request.post("/api/auth/login", { data: user })

    expect(res.ok(), await res.text()).toBe(true)
    const { token } = await res.json()

    await page.goto("/")
    await page.evaluate(t => localStorage.setItem("token", t), token)
    await page.reload()
    const home = new HomePage(page)

    await expect(home.logoutButton()).toBeVisible()
    await use(home)
  },
})

export { expect }
