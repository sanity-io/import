type Indexable = Record<number | string, unknown>

function isIndexable(value: unknown): value is Indexable {
  return typeof value === 'object' && value !== null
}

/**
 * Get a nested value from an object by path array. Similar to lodash `get`.
 */
export function deepGet(obj: unknown, path: (number | string)[]): unknown {
  let current = obj
  for (const key of path) {
    if (!isIndexable(current)) {
      return undefined
    }
    current = current[key]
  }
  return current
}

/**
 * Set a nested value on an object by path array. Mutates in place.
 * Creates intermediate objects/arrays as needed. Similar to lodash `set`.
 */
export function deepSet(obj: Indexable, path: (number | string)[], value: unknown): void {
  if (path.length === 0) return

  let current: Indexable = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    const next = path[i + 1]!
    if (!isIndexable(current[key])) {
      current[key] = typeof next === 'number' ? [] : {}
    }
    current = current[key] as Indexable
  }
  current[path.at(-1)!] = value
}

/**
 * Delete a nested value from an object by path array. Mutates in place.
 * Similar to lodash `unset`.
 */
export function deepUnset(obj: Indexable, path: (number | string)[]): void {
  if (path.length === 0) return

  let current: Indexable = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    if (!isIndexable(current[key])) {
      return
    }
    current = current[key]
  }
  delete current[path.at(-1)!]
}
