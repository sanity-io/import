import {type SanityDocument} from '../types.js'

export function ensureUniqueIds(documents: SanityDocument[]): void {
  const seen: string[] = []
  const duplicates: string[] = []

  for (const doc of documents) {
    if (!doc._id) {
      continue
    }

    if (seen.includes(doc._id)) {
      duplicates.push(doc._id)
    } else {
      seen.push(doc._id)
    }
  }

  const numDupes = duplicates.length
  if (numDupes === 0) {
    return
  }

  throw new Error(
    `Found ${numDupes} duplicate IDs in the source file:\n- ${duplicates.join('\n- ')}`,
  )
}
