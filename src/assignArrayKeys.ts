import crypto from 'crypto'
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
  const bytes = crypto.randomBytes(length * 2)
  const base64 = bytes.toString('base64')
  const alphaNum = base64.replace(/[^a-z0-9]/gi, '')
  return alphaNum.slice(0, length)
}

export {assignArrayKeys}
