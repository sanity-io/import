import {Readable, Writable} from 'node:stream'

/**
 * Type guard to check if an unknown value is a readable stream
 */
export function isReadableStream(stream: unknown): stream is NodeJS.ReadableStream {
  return (
    stream instanceof Readable ||
    (stream !== null &&
      typeof stream === 'object' &&
      'readable' in stream &&
      typeof (stream as Record<string, unknown>).readable === 'boolean')
  )
}

/**
 * Type guard to check if an unknown value is a writable stream
 */
export function isWritableStream(stream: unknown): stream is NodeJS.WritableStream {
  return (
    stream instanceof Writable ||
    (stream !== null &&
      typeof stream === 'object' &&
      'writable' in stream &&
      typeof (stream as Record<string, unknown>).writable === 'boolean')
  )
}
