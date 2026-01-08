import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
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
  const stream = await getStream(uri)
  const hash = createHash('sha1')
  const chunks: Buffer[] = []

  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
    hash.update(chunk)
  })

  await finished(stream)
  return {
    buffer: Buffer.concat(chunks),
    sha1hash: hash.digest('hex'),
  }
}

async function getStream(uri: string): Promise<NodeJS.ReadableStream> {
  const parsed = new URL(uri)
  const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  const isFile = parsed.protocol === 'file:'
  if (isHttp) {
    const res = (await request({url: parsed.href, stream: true})) as GetItResponse
    return res.body
  }

  // For file:// URLs, use fs.createReadStream directly to avoid file descriptor issues
  if (isFile) {
    try {
      const filePath = fileURLToPath(uri)
      return createReadStream(filePath)
    } catch (err) {
      throw new Error(readError(uri, err as Error))
    }
  }

  // For ftp, data urls, and other protocols
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
