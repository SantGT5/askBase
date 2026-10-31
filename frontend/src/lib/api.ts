// Calls go to /api/*, which Vite proxies to the Flask backend (see vite.config.ts), so no CORS is needed.
const TOKEN_KEY = "token"

export const getToken = () => localStorage.getItem(TOKEN_KEY)

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// APIFlask errors look like {message, detail: {json: {field: ["problem"]}}}
type ErrorBody = { message?: string; detail?: Record<string, Record<string, string[]>> }

function errorMessage(body: ErrorBody, status: number) {
  const fields = body.detail?.json ?? body.detail?.files

  if (fields) {
    return Object.entries(fields)
      .map(([field, problems]) => `${field}: ${problems.join(" ")}`)
      .join("; ")
  }

  return body.message ?? `Request failed (${status})`
}

export async function post<T>(path: string, body: object | FormData): Promise<T> {
  const token = getToken()
  const isForm = body instanceof FormData
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: isForm ? body : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status))

  return data as T
}

export type Document = { id: number; title: string; chunks: number }
export type Source = { n: number; title: string; content: string }
export type Answer = { answer: string; sources: Source[] }
