import {uuid} from '@sanity/uuid'

import type {SanityDocument} from './types.js'

export default function assignDocumentId(doc: Partial<SanityDocument>): SanityDocument {
  if (doc._id) {
    return doc as SanityDocument
  }

  return Object.assign({_id: uuid()}, doc) as SanityDocument
}
