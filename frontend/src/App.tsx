import { LogOut } from "lucide-react"
import { useState } from "react"

import { AddContextCard } from "@/components/add-context-card"
import { AskCard } from "@/components/ask-card"
import { AuthCard } from "@/components/auth-card"
import { ModeToggle } from "@/components/mode-toggle"
import { Button } from "@/components/ui/button"
import { ApiError, getToken, setToken } from "@/lib/api"

export function App() {
  const [token, setTokenState] = useState(getToken)

  function login(next: string | null) {
    setToken(next)
    setTokenState(next)
  }

  // Shared by the cards: an expired/invalid token sends the user back to the login screen
  function handleError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) login(null)
    return (err as Error).message
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <span className="font-heading text-lg font-semibold">askBase</span>
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
          <div className="grid w-full max-w-6xl items-start gap-6 lg:grid-cols-[2fr_3fr]">
            <AddContextCard onError={handleError} />
            <AskCard onError={handleError} />
          </div>
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
