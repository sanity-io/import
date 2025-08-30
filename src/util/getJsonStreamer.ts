import split from 'split2'

import documentHasErrors from '../documentHasErrors.js'
import type {SanityDocument} from '../types.js'

export default function getJsonStreamer(): NodeJS.ReadWriteStream {
  let lineNumber = 0

  const getErrorMessage = (err: Error): string => {
    const suffix =
      lineNumber === 1 ? '\n\nMake sure this is valid ndjson (one JSON-document *per line*)' : ''

    return `Failed to parse line #${lineNumber}: ${err.message}${suffix}`
  }

  return split(parseRow)

  function parseRow(this: any, row: string) {
    lineNumber++

    if (!row) {
      return undefined
    }

    try {
      const doc: SanityDocument = JSON.parse(row)
      const error = documentHasErrors(doc)
      if (error) {
        throw new Error(error)
      }

      return doc
    } catch (err) {
      const errorMessage = getErrorMessage(err as Error)
      this.emit('error', new Error(errorMessage))
    }

    return undefined
  }
}
