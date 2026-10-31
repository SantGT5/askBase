import type { Page } from "@playwright/test"

type UploadFile = { name: string; mimeType: string; buffer: Buffer }

// Page object for the logged-in screen: header with the page links, the "Ask" page and the "Add context" page.
export class HomePage {
  constructor(readonly page: Page) {}

  // Header
  logoutButton = () => this.page.getByRole("button", { name: "Log out" })
  themeButton = () => this.page.getByRole("button", { name: "Change theme" })

  askLink = () => this.page.getByRole("link", { name: "Ask" })
  addContextLink = () => this.page.getByRole("link", { name: "Add context" })

  async setTheme(name: "Light" | "Dark" | "System") {
    await this.themeButton().click()
    await this.page.getByRole("menuitemradio", { name }).click()
  }

  // Add context card
  titleInput = () => this.page.getByLabel("Title")
  textInput = () => this.page.getByRole("textbox", { name: "Text", exact: true })
  fileInput = () => this.page.getByLabel(/^File \(/)
  addButton = () => this.page.getByRole("button", { name: "Add to knowledge base" })
  addStatus = () => this.page.getByRole("status")

  async addText(title: string, text: string) {
    await this.addContextLink().click()
    await this.page.getByRole("tab", { name: "Text" }).click()
    await this.titleInput().fill(title)
    await this.textInput().fill(text)
    await this.addButton().click()
  }

  async upload(file: UploadFile) {
    await this.addContextLink().click()
    await this.page.getByRole("tab", { name: "File" }).click()
    await this.fileInput().setInputFiles(file)
    await this.addButton().click()
  }

  // Ask page
  emptyState = () => this.page.getByRole("heading", { name: "What would you like to know?" })
  questionInput = () => this.page.getByLabel("Question")
  askButton = () => this.page.getByRole("button", { name: "Ask", exact: true })
  searchTypeButton = () => this.page.getByRole("button", { name: /^Search type/ })
  newChatButton = () => this.page.getByRole("button", { name: "New chat" })
  askError = () => this.page.getByRole("alert")
  sources = () => this.page.getByRole("listitem")

  async setSearchType(name: "Similarity" | "Multi-query" | "Hybrid") {
    await this.searchTypeButton().click()
    await this.page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click()
  }

  async ask(question: string) {
    await this.questionInput().fill(question)
    await this.askButton().click()
  }
}
