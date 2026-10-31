import { ArrowUp, ChevronDown, Loader2, Plus, Search } from "lucide-react"

import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  type AskEvent,
  postStream,
  type SearchMode,
  type Source,
  type Turn,
} from "@/lib/api"

type Exchange = { question: string; answer: string; sources: Source[]; done: boolean }

// Same caps as AskIn in backend/app.py: last 20 turns (10 questions + answers), each turn at most 20000 chars
const MAX_TURNS = 20
const MAX_TURN_CHARS = 20000

const SEARCH_MODES: { value: SearchMode; label: string; hint: string }[] = [
  { value: "similarity", label: "Similarity", hint: "Closest in meaning. Fastest." },
  {
    value: "multi_query",
    label: "Multi-query",
    hint: "Also searches 3 rewordings. Finds more, slower.",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    hint: "Meaning plus exact words. Best for names, dates and IDs.",
  },
]

export function AskPage({ onError }: { onError: (err: unknown) => string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // The chat lives only here: it is sent with each question as the model's memory, and "New chat" empties it
  const [chat, setChat] = useState<Exchange[]>([])
  const [draft, setDraft] = useState("")
  const [mode, setMode] = useState<SearchMode>("similarity")
  const modeLabel = SEARCH_MODES.find(m => m.value === mode)?.label

  // Follow the answer as it streams in
  useEffect(() => {
    if (chat.length) window.scrollTo({ top: document.body.scrollHeight })
  }, [chat])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const question = draft.trim()

    if (busy || !question) return // Ctrl+Enter can submit even while the button is disabled
    const history: Turn[] = chat
      .flatMap((x): Turn[] => [
        { role: "human", content: x.question },
        { role: "ai", content: x.answer },
      ])
      .slice(-MAX_TURNS)
      .map(t => ({ ...t, content: t.content.slice(0, MAX_TURN_CHARS) }))
    const updateLast = (change: (x: Exchange) => Exchange) =>
      setChat(c => [...c.slice(0, -1), change(c[c.length - 1])])

    setChat(c => [...c, { question, answer: "", sources: [], done: false }])
    setDraft("")
    setBusy(true)
    setError("")

    try {
      let finished = false

      await postStream<AskEvent>("/ask", { question, history, mode }, event => {
        if (event.type === "token") updateLast(x => ({ ...x, answer: x.answer + event.text }))
        else if (event.type === "done") {
          finished = true
          updateLast(x => ({ ...x, sources: event.sources, done: true }))
        } else throw new ApiError(502, event.message)
      })
      if (!finished) throw new Error("The answer was cut off. Please try again.")
    } catch (err) {
      setChat(c => c.slice(0, -1)) // drop the failed exchange and put the question back so it can be retried
      setDraft(question)
      setError(onError(err))
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
    <div className="flex flex-1 flex-col gap-6">
      {/* The composer below stays in the same place in the tree, so it keeps focus when it moves to the bottom */}
      {chat.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-end gap-2 text-center">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            What would you like to know?
          </h1>
          <p className="text-muted-foreground">Answers come only from the documents you added.</p>
        </div>
      ) : (
        <div aria-live="polite" aria-busy={busy} className="flex flex-1 flex-col gap-8">
          {chat.map((x, i) => (
            <div key={i} className="flex flex-col gap-3">
              <p className="max-w-[85%] self-end rounded-2xl bg-muted px-4 py-2 whitespace-pre-wrap">
                {x.question}
              </p>
              {x.answer ? (
                <p className="leading-relaxed whitespace-pre-wrap">{x.answer}</p>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Searching your documents…
                </p>
              )}
              {x.sources.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Sources</h3>
                  <ol className="flex flex-col gap-2">
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
      )}

      <div className={chat.length ? "sticky bottom-0 bg-background pb-2" : ""}>
        {error && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <form
          onSubmit={submit}
          className="flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-sm transition-shadow focus-within:ring-3 focus-within:ring-ring/50"
        >
          <Textarea
            name="question"
            aria-label="Question"
            aria-describedby="ask-hint"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={chat.length ? "Ask a follow-up…" : "Ask about your documents…"}
            maxLength={2000}
            onKeyDown={sendOnModEnter}
            className="max-h-60 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
            required
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={`Search type: ${modeLabel}`}>
                    <Search />
                    {modeLabel}
                    <ChevronDown className="opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuLabel>Search type</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={mode}
                    onValueChange={value => setMode(value as SearchMode)}
                  >
                    {SEARCH_MODES.map(m => (
                      <DropdownMenuRadioItem key={m.value} value={m.value} className="items-start">
                        <span className="flex flex-col">
                          <span>{m.label}</span>
                          <span className="text-xs text-muted-foreground">{m.hint}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {chat.length > 0 && (
                <Button variant="ghost" size="sm" onClick={newChat} disabled={busy}>
                  <Plus />
                  New chat
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span id="ask-hint" className="hidden text-xs text-muted-foreground sm:inline">
                Ctrl/⌘ + Enter to send
              </span>
              <Button type="submit" size="icon" disabled={busy} aria-label="Ask">
                {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            </div>
          </div>
        </form>
      </div>
      {/* Balances the heading above, so the empty-state input sits in the middle of the page */}
      {chat.length === 0 && <div aria-hidden className="flex-1" />}
    </div>
  )
}
