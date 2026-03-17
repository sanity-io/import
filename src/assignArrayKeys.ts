import {getRandomValues} from 'node:crypto'

type PlainObject = Record<string, unknown>

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Note: Mutates in-place
function assignArrayKeys<T>(obj: T): T {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (isPlainObject(item) && !('_key' in (item as object))) {
        ;(item as PlainObject)._key = generateKey()
      }

      assignArrayKeys(item)
    }

    return obj
  }

  if (isPlainObject(obj)) {
    const plainObj = obj as PlainObject
    for (const key of Object.keys(plainObj)) {
      assignArrayKeys(plainObj[key])
    }

    return obj
  }

  return obj
}

function generateKey(length = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(length)
  getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export {assignArrayKeys}
