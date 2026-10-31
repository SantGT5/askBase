import { FilePlus, LogOut, MessageSquare } from "lucide-react"

import { useEffect, useState } from "react"

import { AddContextCard } from "@/components/add-context-card"
import { AskPage } from "@/components/ask-page"
import { AuthCard } from "@/components/auth-card"
import { ModeToggle } from "@/components/mode-toggle"
import { Button, buttonVariants } from "@/components/ui/button"
import { ApiError, getToken, setToken } from "@/lib/api"

type Page = "ask" | "add"

// The page lives in the URL hash (#/ or #/add), so reload and the back button keep it without a router
const pageFromHash = (): Page => (window.location.hash === "#/add" ? "add" : "ask")

export function App() {
  const [token, setTokenState] = useState(getToken)
  const [page, setPage] = useState(pageFromHash)

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash())

    window.addEventListener("hashchange", onHashChange)

    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  // Coming back to Ask lands on the latest message, not the top of a long chat
  useEffect(() => {
    if (page === "ask") window.scrollTo({ top: document.body.scrollHeight })
  }, [page])

  function login(next: string | null) {
    setToken(next)
    setTokenState(next)
  }

  // Shared by the pages: an expired/invalid token sends the user back to the login screen
  function handleError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) login(null)

    return (err as Error).message
  }

  const navLink = (to: Page, href: string, icon: React.ReactNode, label: string) => (
    <a
      href={href}
      aria-current={page === to ? "page" : undefined}
      className={buttonVariants({ variant: page === to ? "secondary" : "ghost", size: "sm" })}
    >
      {icon}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </a>
  )

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <span className="font-heading text-lg font-semibold">askBase</span>
          {token && (
            <nav aria-label="Main" className="flex gap-1">
              {navLink("ask", "#/", <MessageSquare />, "Ask")}
              {navLink("add", "#/add", <FilePlus />, "Add context")}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle />
          {token && (
            <Button variant="ghost" onClick={() => login(null)}>
              <LogOut />
              Log out
            </Button>
          )}
        </div>
      </header>

      <main className="flex flex-1 justify-center p-4 sm:p-6">
        {token ? (
          <>
            {/* Both pages stay mounted, so the chat survives a trip to "Add context" */}
            <div className={`w-full max-w-3xl flex-col ${page === "ask" ? "flex" : "hidden"}`}>
              <AskPage onError={handleError} />
            </div>
            <div className={`w-full max-w-2xl ${page === "add" ? "block" : "hidden"}`}>
              <AddContextCard onError={handleError} />
            </div>
          </>
        ) : (
          <div className="flex w-full items-center justify-center">
            <AuthCard onLogin={login} />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
