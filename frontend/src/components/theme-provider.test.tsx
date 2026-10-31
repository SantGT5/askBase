import { act, cleanup, render, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReactNode } from "react"

import { ThemeProvider, useTheme } from "@/components/theme-provider"

// jsdom has no matchMedia; `systemDark` controls what the OS "prefers"
let systemDark = false
let changeListener: (() => void) | undefined

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ""
  systemDark = false
  changeListener = undefined
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return systemDark
    },
    addEventListener: (_: string, fn: () => void) => (changeListener = fn),
    removeEventListener: () => (changeListener = undefined),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>
const rootClass = () => document.documentElement.className

describe("ThemeProvider", () => {
  it("defaults to system and follows the OS preference", () => {
    systemDark = true
    const { result } = renderHook(useTheme, { wrapper })

    expect(result.current.theme).toBe("system")
    expect(rootClass()).toBe("dark")
  })

  it("reacts when the OS preference changes", () => {
    renderHook(useTheme, { wrapper })
    expect(rootClass()).toBe("light")

    systemDark = true
    act(() => changeListener?.())

    expect(rootClass()).toBe("dark")
  })

  it("restores a stored theme and ignores invalid ones", () => {
    localStorage.setItem("theme", "dark")
    expect(renderHook(useTheme, { wrapper }).result.current.theme).toBe("dark")

    cleanup()
    localStorage.setItem("theme", "purple")
    expect(renderHook(useTheme, { wrapper }).result.current.theme).toBe("system")
  })

  it("setTheme applies the class and persists it", () => {
    const { result } = renderHook(useTheme, { wrapper })

    act(() => result.current.setTheme("dark"))

    expect(result.current.theme).toBe("dark")
    expect(rootClass()).toBe("dark")
    expect(localStorage.getItem("theme")).toBe("dark")
    expect(changeListener).toBeUndefined() // stops following the OS
  })

  it("syncs when another tab changes the theme", () => {
    const { result } = renderHook(useTheme, { wrapper })

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "theme", newValue: "dark", storageArea: localStorage })
      )
    })

    expect(result.current.theme).toBe("dark")
  })

  it("useTheme throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const Orphan = () => <>{useTheme().theme}</>

    expect(() => render(<Orphan />)).toThrow("useTheme must be used within a ThemeProvider")
  })
})
