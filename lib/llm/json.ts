/**
 * Robust JSON extraction from LLM responses.
 *
 * Handles the common ways models wrap JSON:
 *   - ```json … ``` / ``` … ``` fences
 *   - leading prose ("Here is the report:") before the object
 *   - trailing prose after the object
 *
 * It does NOT repair truncated JSON — if the model ran out of output tokens the
 * result is still invalid; the fix for that is a larger maxTokens, not parsing.
 */
export function extractJson(raw: string): string {
  let s = (raw ?? '').trim()

  // 1. If a fenced block exists, prefer its inner content.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  else s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim() // unterminated fence

  // 2. Slice from the first opening brace/bracket to the last closing one.
  const firstObj = s.indexOf('{')
  const firstArr = s.indexOf('[')
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr)
  const lastObj = s.lastIndexOf('}')
  const lastArr = s.lastIndexOf(']')
  const end = Math.max(lastObj, lastArr)
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1)

  return s.trim()
}

/** Parse helper that returns null instead of throwing. */
export function parseJsonSafe<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(extractJson(raw)) as T
  } catch {
    return null
  }
}

/**
 * Escape raw control characters that appear INSIDE quoted string values.
 *
 * LLMs (especially for multi-line Chinese phone scripts / email bodies) often
 * emit a literal newline inside a JSON string, which is invalid JSON. This walks
 * the text tracking in-string / escape state and converts only the control chars
 * that fall inside a string — structural whitespace between tokens is untouched.
 */
export function sanitizeJsonControlChars(s: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escaped) { out += ch; escaped = false; continue }
    if (ch === '\\') { out += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; out += ch; continue }
    if (inString) {
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
      const code = ch.charCodeAt(0)
      if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue }
    }
    out += ch
  }
  return out
}

export interface JsonParseResult<T> {
  ok: boolean
  value?: T
  /** true when the control-char sanitizer was needed to make it parse. */
  repairUsed: boolean
  error?: string
}

/**
 * Two-stage parse: normal JSON.parse, then a control-char sanitizer pass.
 * Does NOT call an LLM — a caller that wants a model repair retry does that
 * itself after this returns `ok: false`.
 */
export function parseJsonWithRepair<T = unknown>(raw: string): JsonParseResult<T> {
  const extracted = extractJson(raw)
  try {
    return { ok: true, value: JSON.parse(extracted) as T, repairUsed: false }
  } catch (e1) {
    try {
      const repaired = sanitizeJsonControlChars(extracted)
      return { ok: true, value: JSON.parse(repaired) as T, repairUsed: true }
    } catch (e2) {
      return {
        ok: false, repairUsed: true,
        error: `parse: ${errMsg(e1)} | sanitize: ${errMsg(e2)}`,
      }
    }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
