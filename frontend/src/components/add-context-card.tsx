import { Loader2 } from "lucide-react"

import { type FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { type Document, post } from "@/lib/api"

export function AddContextCard({ onError }: { onError: (err: unknown) => string }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>, path: string, body: object | FormData) {
    e.preventDefault()
    const form = e.currentTarget

    setBusy(true)
    setStatus(null)

    try {
      const doc = await post<Document>(path, body)

      setStatus({
        ok: true,
        text: `Added "${doc.title}" (${doc.chunks} chunk${doc.chunks === 1 ? "" : "s"})`,
      })
      form.reset()
    } catch (err) {
      setStatus({ ok: false, text: onError(err) })
    } finally {
      setBusy(false)
    }
  }

  const submitButton = (
    <Button type="submit" disabled={busy} className="self-end">
      {busy && <Loader2 className="animate-spin" />}
      Add to knowledge base
    </Button>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add context</CardTitle>
        <CardDescription>Paste text or upload a PDF / Markdown file.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs defaultValue="text" onValueChange={() => setStatus(null)}>
          <TabsList className="w-full">
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="file">File</TabsTrigger>
          </TabsList>

          <TabsContent value="text">
            <form
              className="flex flex-col gap-4 pt-2"
              onSubmit={e =>
                submit(e, "/documents/text", Object.fromEntries(new FormData(e.currentTarget)))
              }
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" maxLength={200} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="text">Text</Label>
                <Textarea id="text" name="text" className="min-h-40" required />
              </div>
              {submitButton}
            </form>
          </TabsContent>

          <TabsContent value="file">
            <form
              className="flex flex-col gap-4 pt-2"
              onSubmit={e => submit(e, "/documents/upload", new FormData(e.currentTarget))}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="file">File (.pdf or .md, up to 10 MB)</Label>
                <Input id="file" name="file" type="file" accept=".pdf,.md" required />
              </div>
              {submitButton}
            </form>
          </TabsContent>
        </Tabs>

        {status && (
          <p
            role="status"
            className={status.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
          >
            {status.text}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
