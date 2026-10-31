import { Loader2, Send } from "lucide-react"

import { type FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { type Answer, post } from "@/lib/api"

export function AskCard({ onError }: { onError: (err: unknown) => string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<Answer | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const { question } = Object.fromEntries(new FormData(e.currentTarget))

    setBusy(true)
    setError("")

    try {
      setResult(await post<Answer>("/ask", { question }))
    } catch (err) {
      setError(onError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask</CardTitle>
        <CardDescription>Answers come only from the documents you added.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            name="question"
            aria-label="Question"
            placeholder="What would you like to know?"
            maxLength={2000}
            required
          />
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            Ask
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div aria-live="polite" className="flex flex-col gap-6">
          {result && (
            <>
              <p className="leading-relaxed whitespace-pre-wrap">{result.answer}</p>
              {result.sources.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Sources</h3>
                  <ol className="flex flex-col gap-3">
                    {result.sources.map(s => (
                      <li key={s.n} className="rounded-lg border p-3 text-sm">
                        <p className="font-medium">
                          [{s.n}] {s.title}
                        </p>
                        <p className="mt-1 line-clamp-3 text-muted-foreground">{s.content}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
