import * as React from "react"

type Theme = "dark" | "light" | "system"
type ResolvedTheme = "dark" | "light"

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const STORAGE_KEY = "theme"
const DEFAULT_THEME: Theme = "system"
const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const THEME_VALUES: Theme[] = ["dark", "light", "system"]

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(undefined)

function isTheme(value: string | null): value is Theme {
  return THEME_VALUES.includes(value as Theme)
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? "dark" : "light"
}

function disableTransitionsTemporarily() {
  const style = document.createElement("style")

  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
    )
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        style.remove()
      })
    })
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const restoreTransitions = disableTransitionsTemporarily()

  root.classList.remove("light", "dark")
  root.classList.add(theme === "system" ? getSystemTheme() : theme)
  restoreTransitions()
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const storedTheme = localStorage.getItem(STORAGE_KEY)

    return isTheme(storedTheme) ? storedTheme : DEFAULT_THEME
  })

  const setTheme = React.useCallback((nextTheme: Theme) => {
    localStorage.setItem(STORAGE_KEY, nextTheme)
    setThemeState(nextTheme)
  }, [])

  React.useEffect(() => {
    applyTheme(theme)

    if (theme !== "system") {
      return undefined
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => applyTheme("system")

    mediaQuery.addEventListener("change", handleChange)

    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme])

  // Keep other open tabs in sync
  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== STORAGE_KEY) {
        return
      }

      setThemeState(isTheme(event.newValue) ? event.newValue : DEFAULT_THEME)
    }

    window.addEventListener("storage", handleStorageChange)

    return () => window.removeEventListener("storage", handleStorageChange)
  }, [])

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
