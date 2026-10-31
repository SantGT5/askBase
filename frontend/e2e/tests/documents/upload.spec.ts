import { expect, test } from "../../fixtures"

const file = (name: string, content: string | Buffer, mimeType = "text/plain") => ({
  name,
  mimeType,
  buffer: Buffer.isBuffer(content) ? content : Buffer.from(content),
})

// Real backend: the file is parsed, chunked, embedded and stored.
test.describe("Add context: file upload", () => {
  test("uploads a Markdown file", async ({ home }) => {
    await home.upload(file("notes.md", "# Notes\n\nI like hiking.", "text/markdown"))

    await expect(home.addStatus()).toHaveText('Added "notes.md" (1 chunk)')
    await expect(home.fileInput()).toHaveValue("")
  })

  test("uploads a PDF", async ({ home, browser }) => {
    // Let Chromium print a real PDF instead of keeping a binary fixture in the repo
    const printer = await browser.newPage()

    await printer.setContent("<p>My passport number is X123.</p>")
    const pdf = await printer.pdf()

    await printer.close()

    await home.upload(file("passport.pdf", pdf, "application/pdf"))

    await expect(home.addStatus()).toHaveText('Added "passport.pdf" (1 chunk)')
  })

  test("rejects an unsupported file type", async ({ home }) => {
    await home.upload(file("notes.txt", "hello"))

    await expect(home.addStatus()).toHaveText("Only .pdf and .md files are supported")
  })

  test("rejects a corrupt PDF", async ({ home }) => {
    await home.upload(file("broken.pdf", "not really a pdf", "application/pdf"))

    await expect(home.addStatus()).toHaveText("Could not read the file")
  })

  test("rejects a file with no text", async ({ home }) => {
    await home.upload(file("empty.md", "  \n ", "text/markdown"))

    await expect(home.addStatus()).toHaveText("No text found in the file (scanned PDFs need OCR)")
  })
})
