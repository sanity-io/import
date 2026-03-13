import {Transform, type TransformCallback} from 'node:stream'
import {StringDecoder} from 'node:string_decoder'

import {validateDocument} from '../documentHasErrors.js'
import {type SanityDocument} from '../types.js'
import {
  ReplacementCharError,
  validateLineForReplacementChar,
} from './validateReplacementCharacters.js'

interface JsonStreamerOptions {
  allowReplacementCharacters?: boolean | undefined
}

export function getJsonStreamer(options: JsonStreamerOptions = {}): NodeJS.ReadWriteStream {
  let lineNumber = 0
  let remainder = ''
  const decoder = new StringDecoder('utf8')
  const {allowReplacementCharacters} = options

  return new Transform({
    objectMode: true,

    transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
      const text = remainder + decoder.write(chunk)
      const lines = text.split('\n')
      // Last element may be an incomplete line - save for next chunk
      remainder = lines.pop() ?? ''

      for (const line of lines) {
        parseLine(this, line)
      }

      callback()
    },

    flush(callback: TransformCallback) {
      // Flush any remaining bytes from the decoder
      remainder += decoder.end()
      if (remainder) {
        parseLine(this, remainder)
        remainder = ''
      }
      callback()
    },
  })

  function parseLine(stream: Transform, row: string) {
    lineNumber++

    if (!row) {
      return
    }

    try {
      if (allowReplacementCharacters !== true) {
        const replacementError = validateLineForReplacementChar(row, lineNumber)
        if (replacementError) {
          throw new ReplacementCharError(replacementError)
        }
      }

      const doc = JSON.parse(row) as SanityDocument
      const error = validateDocument(doc)
      if (error) {
        throw new Error(error)
      }

      stream.push(doc)
    } catch (err) {
      if (err instanceof ReplacementCharError) {
        stream.emit('error', err)
      } else if (err instanceof Error) {
        stream.emit('error', new Error(getErrorMessage(err)))
      } else {
        stream.emit(
          'error',
          new Error(`Unknown error occurred at line #${lineNumber}: ${String(err)}`),
        )
      }
    }
  }

  function getErrorMessage(err: Error): string {
    const suffix =
      lineNumber === 1 ? '\n\nMake sure this is valid ndjson (one JSON-document *per line*)' : ''

    return `Failed to parse line #${lineNumber}: ${err.message}${suffix}`
  }
}
