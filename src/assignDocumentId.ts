import {randomUUID} from 'node:crypto'

import type {SanityDocument} from './types.js'

export function assignDocumentId(doc: Partial<SanityDocument>): SanityDocument {
  if (doc._id) {
    return doc as SanityDocument
  }

  return {_id: randomUUID(), ...doc} as SanityDocument
}
