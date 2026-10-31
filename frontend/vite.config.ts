/// <reference types="vitest/config" />
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"], // e2e/ belongs to Playwright
  },
  server: {
    host: true,
    proxy: {
      // /api/ask -> <backend>/ask. API_URL is http://backend:5000 inside Docker.
      "/api": {
        target: process.env.API_URL ?? "http://localhost:5001",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
})
