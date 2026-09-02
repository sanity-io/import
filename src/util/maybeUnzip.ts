import {PassThrough, Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {createUnzip} from 'node:zlib'

const compressionHeaderLength = 3
const defaultMaxCompressionLayers = 3

/**
 * Transparently decompress gzip and zlib-deflate streams while passing plain input through.
 *
 * The input is inspected by content rather than metadata because import streams do not carry a
 * filename or HTTP headers. Nested compression is supported for compatibility with gunzip-maybe.
 */
export function maybeUnzip(source: AsyncIterable<unknown>): AsyncGenerator<Buffer> {
  return maybeUnzipLayers(source, defaultMaxCompressionLayers)
}

async function* maybeUnzipLayers(
  source: AsyncIterable<unknown>,
  remainingLayers: number,
): AsyncGenerator<Buffer> {
  const {header, replay} = await peekBytes(source, compressionHeaderLength)

  if (!isCompressed(header)) {
    yield* replay
    return
  }

  if (remainingLayers === 0) {
    throw new Error('Maximum recursion reached')
  }

  yield* maybeUnzipLayers(unzip(replay), remainingLayers - 1)
}

async function* unzip(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  const output = new PassThrough()
  const completed = pipeline(Readable.from(source), createUnzip(), output)

  try {
    for await (const chunk of output) {
      yield toBuffer(chunk)
    }
    await completed
  } finally {
    output.destroy()
    await completed.catch(() => undefined)
  }
}

async function peekBytes(
  source: AsyncIterable<unknown>,
  minimumBytes: number,
): Promise<{header: Buffer; replay: AsyncGenerator<Buffer>}> {
  const iterator = source[Symbol.asyncIterator]()
  const buffered: Buffer[] = []
  let bufferedBytes = 0
  let exhausted = false

  while (bufferedBytes < minimumBytes) {
    const next = await iterator.next()
    if (next.done) {
      exhausted = true
      break
    }

    const chunk = toBuffer(next.value)
    if (chunk.length > 0) {
      buffered.push(chunk)
      bufferedBytes += chunk.length
    }
  }

  const header = Buffer.concat(buffered, Math.min(bufferedBytes, minimumBytes))

  async function* replay(): AsyncGenerator<Buffer> {
    try {
      yield* buffered

      while (!exhausted) {
        const next = await iterator.next()
        if (next.done) {
          exhausted = true
          return
        }
        yield toBuffer(next.value)
      }
    } finally {
      if (!exhausted) {
        await iterator.return?.()
      }
    }
  }

  return {header, replay: replay()}
}

function isCompressed(header: Buffer): boolean {
  return isGzip(header) || isDeflate(header)
}

function isGzip(header: Buffer): boolean {
  return header.length >= 3 && header[0] === 0x1f && header[1] === 0x8b && header[2] === 0x08
}

function isDeflate(header: Buffer): boolean {
  return (
    header.length >= 2 &&
    header[0] === 0x78 &&
    (header[1] === 0x01 || header[1] === 0x9c || header[1] === 0xda)
  )
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk
  }

  if (typeof chunk === 'string') {
    return Buffer.from(chunk)
  }

  if (chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk)
  }

  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }

  throw new TypeError('Import streams must emit strings, ArrayBuffers, or ArrayBuffer views')
}
