import {createHash} from 'node:crypto'
import {open} from 'node:fs/promises'
import {finished} from 'node:stream/promises'
import {fileURLToPath} from 'node:url'

import {getIt} from 'get-it'
import {promise} from 'get-it/middleware'
import {getUri} from 'get-uri'

import type {GetItResponse} from '../types.js'
import {retryOnFailure} from './retryOnFailure.js'
import {isReadableStream} from './streamTypeGuards.js'

const request = getIt([promise()])

interface HashedBuffer {
  buffer: Buffer
  sha1hash: string
}

export const getHashedBufferForUri = (uri: string): Promise<HashedBuffer> =>
  retryOnFailure(() => getHashedBufferForUriInternal(uri))

async function getHashedBufferForUriInternal(uri: string): Promise<HashedBuffer> {
  // Handle file:// URIs directly to properly manage FileHandle lifecycle.
  // The get-uri package has a bug where it extracts the numeric fd from a FileHandle
  // and passes it to createReadStream, but never closes the FileHandle itself.
  // This causes EBADF errors in Node.js 22+ when the FileHandle is garbage collected.
  if (/^file:\/\//i.test(uri)) {
    return getHashedBufferForFileUri(uri)
  }

  const stream = await getStream(uri)
  const hash = createHash('sha1')
  const chunks: Buffer[] = []

  try {
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      hash.update(chunk)
    })

    await finished(stream)
    return {
      buffer: Buffer.concat(chunks),
      sha1hash: hash.digest('hex'),
    }
  } finally {
    // Explicitly destroy the stream to ensure cleanup
    if ('destroy' in stream && typeof stream.destroy === 'function') {
      stream.destroy()
    }
  }
}

/**
 * Handle file:// URIs with proper FileHandle management to avoid EBADF errors.
 * We use fs.promises.readFile which properly manages the FileHandle internally.
 */
async function getHashedBufferForFileUri(uri: string): Promise<HashedBuffer> {
  const filepath = fileURLToPath(uri)
  const fileHandle = await open(filepath, 'r')

  try {
    const buffer = await fileHandle.readFile()
    const hash = createHash('sha1')
    hash.update(buffer)
    return {
      buffer,
      sha1hash: hash.digest('hex'),
    }
  } finally {
    await fileHandle.close()
  }
}

async function getStream(uri: string): Promise<NodeJS.ReadableStream> {
  const isHttp = /^https?:\/\//i.test(uri)
  const parsed = new URL(uri)
  if (isHttp) {
    const res = (await request({url: parsed.href, stream: true})) as GetItResponse
    return res.body
  }

  // For ftp, data urls (file:// is handled separately above)
  try {
    const stream = await getUri(uri)
    if (!isReadableStream(stream)) {
      throw new Error(`Invalid stream type returned for URI: ${uri}`)
    }
    return stream
  } catch (err) {
    throw new Error(readError(uri, err as Error))
  }
}

function readError(uri: string, err: Error): string {
  return `Error while fetching asset from "${uri}":\n${err.message}`
}
