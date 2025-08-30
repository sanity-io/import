import crypto from 'crypto'
import {getIt} from 'get-it'
import {promise} from 'get-it/middleware'
import {getUri} from 'get-uri'
import {finished} from 'stream/promises'

import {retryOnFailure} from './retryOnFailure.js'

const request = getIt([promise()])

interface HashedBuffer {
  buffer: Buffer
  sha1hash: string
}

export const getHashedBufferForUri = (uri: string): Promise<HashedBuffer> =>
  retryOnFailure(() => getHashedBufferForUriInternal(uri))

async function getHashedBufferForUriInternal(uri: string): Promise<HashedBuffer> {
  const stream = await getStream(uri)
  const hash = crypto.createHash('sha1')
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
  const isHttp = /^https?:\/\//i.test(uri)
  const parsed = new URL(uri)
  if (isHttp) {
    return request({url: parsed.href, stream: true}).then(
      (res: {body: NodeJS.ReadableStream}) => res.body,
    )
  }

  // For file, ftp, data urls
  try {
    const stream = await getUri(uri)
    return stream as NodeJS.ReadableStream
  } catch (err) {
    throw new Error(readError(uri, err as Error))
  }
}

function readError(uri: string, err: Error): string {
  return `Error while fetching asset from "${uri}":\n${err.message}`
}
