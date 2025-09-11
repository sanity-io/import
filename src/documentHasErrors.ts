import type {SanityDocument} from './types.js'

export function validateDocument(doc: unknown): string | null {
  const document = doc as Partial<SanityDocument>

  if (typeof document._id !== 'undefined' && typeof document._id !== 'string') {
    return `Document contained an invalid "_id" property - must be a string`
  }

  if (typeof document._id !== 'undefined' && !/^[a-z0-9_.-]+$/i.test(document._id)) {
    return `Document ID "${document._id}" is not valid: Please use alphanumeric document IDs. Dashes (-) and underscores (_) are also allowed.`
  }

  if (typeof document._type !== 'string') {
    return `Document did not contain required "_type" property of type string`
  }

  return null
}

export function documentHasError(doc: unknown, index: number): void {
  const err = validateDocument(doc)
  if (err) {
    throw new Error(`Failed to parse document at index #${index}: ${err}`)
  }
}
