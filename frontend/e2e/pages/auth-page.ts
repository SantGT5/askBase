import type { Page } from "@playwright/test"

// Page object for the login/register card, so specs read as user steps.
export class AuthPage {
  constructor(private page: Page) {}

  heading = () => this.page.getByText(/^(Welcome back|Create an account)$/)
  email = () => this.page.getByLabel("Email")
  password = () => this.page.getByLabel("Password")
  error = () => this.page.getByRole("alert")
  logoutButton = () => this.page.getByRole("button", { name: "Log out" })

  async goto() {
    await this.page.goto("/")
  }

  async login(email: string, password: string) {
    await this.email().fill(email)
    await this.password().fill(password)
    await this.page.getByRole("button", { name: "Log in", exact: true }).click()
  }

  async register(email: string, password: string) {
    await this.page.getByRole("tab", { name: "Register" }).click()
    await this.email().fill(email)
    await this.password().fill(password)
    await this.page.getByRole("button", { name: "Register", exact: true }).click()
  }
}
