import {getRandomValues} from 'node:crypto'

import {isPlainObject} from 'lodash-es'

type PlainObject = Record<string, unknown>

// Note: Mutates in-place
function assignArrayKeys<T>(obj: T): T {
  if (Array.isArray(obj)) {
    obj.forEach((item: unknown) => {
      if (isPlainObject(item) && !('_key' in (item as object))) {
        ;(item as PlainObject)._key = generateKey()
      }

      assignArrayKeys(item)
    })

    return obj
  }

  if (isPlainObject(obj)) {
    const plainObj = obj as PlainObject
    Object.keys(plainObj).forEach((key: string) => {
      assignArrayKeys(plainObj[key])
    })

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
