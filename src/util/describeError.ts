const MAX_CAUSE_DEPTH = 5

/**
 * `fetch` reports network problems as a bare `TypeError: fetch failed` and tucks the actual
 * reason (ECONNREFUSED, DNS failure, TLS error) away in `cause`. Flatten the chain so the reason
 * ends up in the message users actually see.
 */
export function describeError(err: unknown): string {
  const messages: string[] = []
  let current: unknown = err

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth++) {
    const error = unwrap(current)
    const message = error.message.trim()

    // Skip anything already covered by a message further up the chain, so we don't end up with
    // `fetch failed: fetch failed` for wrappers that just re-throw with the same message.
    if (message && !messages.some((seen) => seen.includes(message))) {
      messages.push(message)
    }

    current = error.cause
  }

  return messages.join(': ') || String(err)
}

/**
 * Undici reports a failed connection as an AggregateError with an empty message, keeping the
 * useful part (`connect ECONNREFUSED …`) on the individual attempts. Step through to the first
 * of those so the chain walk sees a real message.
 */
function unwrap(err: Error): Error {
  if (!(err instanceof AggregateError) || err.message.trim()) {
    return err
  }

  const first = err.errors.find((candidate: unknown) => candidate instanceof Error)
  return first ?? err
}
