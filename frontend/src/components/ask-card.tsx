import { Loader2, Plus, Send } from "lucide-react"

import { type FormEvent, type KeyboardEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { type Answer, post, type Turn } from "@/lib/api"

type Exchange = Answer & { question: string }

// Same caps as AskIn in backend/app.py: last 20 turns (10 questions + answers), each turn at most 20000 chars
const MAX_TURNS = 20
const MAX_TURN_CHARS = 20000

export function AskCard({ onError }: { onError: (err: unknown) => string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // The chat lives only here: it is sent with each question as the model's memory, and "New chat" empties it
  const [chat, setChat] = useState<Exchange[]>([])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return // Ctrl+Enter can submit even while the button is disabled
    const form = e.currentTarget
    const question = String(new FormData(form).get("question"))
    const history: Turn[] = chat
      .flatMap((x): Turn[] => [
        { role: "human", content: x.question },
        { role: "ai", content: x.answer },
      ])
      .slice(-MAX_TURNS)
      .map(t => ({ ...t, content: t.content.slice(0, MAX_TURN_CHARS) }))

    setBusy(true)
    setError("")

    try {
      const result = await post<Answer>("/ask", { question, history })

      setChat(c => [...c, { question, ...result }])
      form.reset()
    } catch (err) {
      setError(onError(err)) // the question stays in the box so it can be retried
    } finally {
      setBusy(false)
    }
  }

  function newChat() {
    setChat([])
    setError("")
  }

  // Enter adds a new line; Ctrl+Enter (⌘+Enter on Mac) sends
  function sendOnModEnter(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask</CardTitle>
        <CardDescription>
          Answers come only from the documents you added. Follow-up questions remember this chat.
        </CardDescription>
        <CardAction>
          <Button variant="outline" onClick={newChat} disabled={busy || chat.length === 0}>
            <Plus />
            New chat
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div aria-live="polite" className="flex flex-col gap-6">
          {chat.map((x, i) => (
            <div key={i} className="flex flex-col gap-4">
              <p className="max-w-[85%] self-end rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap">
                {x.question}
              </p>
              <p className="leading-relaxed whitespace-pre-wrap">{x.answer}</p>
              {x.sources.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Sources</h3>
                  <ol className="flex flex-col gap-3">
                    {x.sources.map(s => (
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
            </div>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <form onSubmit={submit} className="flex flex-col gap-2">
          <Textarea
            name="question"
            aria-label="Question"
            aria-describedby="ask-hint"
            placeholder={chat.length ? "Ask a follow-up…" : "What would you like to know?"}
            maxLength={2000}
            onKeyDown={sendOnModEnter}
            className="max-h-60"
            required
          />
          <div className="flex items-center justify-between gap-2">
            <p id="ask-hint" className="text-xs text-muted-foreground">
              Enter for a new line, Ctrl/⌘ + Enter to send
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              Ask
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
