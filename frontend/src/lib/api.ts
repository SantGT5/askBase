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

function send(path: string, body: object | FormData) {
  const token = getToken()
  const isForm = body instanceof FormData

  return fetch(`/api${path}`, {
    method: "POST",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: isForm ? body : JSON.stringify(body),
  })
}

async function failure(res: Response) {
  const data = await res.json().catch(() => ({}))

  return new ApiError(res.status, errorMessage(data, res.status))
}

export async function post<T>(path: string, body: object | FormData): Promise<T> {
  const res = await send(path, body)

  if (!res.ok) throw await failure(res)

  return (await res.json().catch(() => ({}))) as T
}

// For endpoints that stream newline-delimited JSON: calls onEvent for each line as it arrives
export async function postStream<E>(path: string, body: object, onEvent: (event: E) => void) {
  const res = await send(path, body)

  if (!res.ok || !res.body) throw await failure(res)

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""

  for (;;) {
    const { value, done } = await reader.read()

    if (done) break
    buffer += value
    const lines = buffer.split("\n")

    buffer = lines.pop() ?? "" // the last piece may be half a line: keep it for the next read
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line))
  }

  if (buffer.trim()) onEvent(JSON.parse(buffer))
}

export type Document = { id: number; title: string; chunks: number }
export type Source = { n: number; title: string; content: string }
export type AskEvent =
  | { type: "token"; text: string }
  | { type: "done"; sources: Source[] }
  | { type: "error"; message: string }
export type SearchMode = "similarity" | "multi_query" | "hybrid"
export type Turn = { role: "human" | "ai"; content: string }
