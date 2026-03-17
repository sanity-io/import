import {createHash} from 'node:crypto'
import {open} from 'node:fs/promises'
import {Readable} from 'node:stream'
import {finished} from 'node:stream/promises'
import {fileURLToPath} from 'node:url'

import {getIt} from 'get-it'
import {promise} from 'get-it/middleware'

import {type GetItResponse} from '../types.js'
import {retryOnFailure} from './retryOnFailure.js'

const request = getIt([promise()])

interface HashedBuffer {
  buffer: Buffer
  sha1hash: string
}

export const getHashedBufferForUri = (uri: string): Promise<HashedBuffer> =>
  retryOnFailure(() => getHashedBufferForUriInternal(uri))

async function getHashedBufferForUriInternal(uri: string): Promise<HashedBuffer> {
  if (/^file:\/\//i.test(uri)) {
    return getHashedBufferFromBytes(await readFileUri(uri))
  }

  if (/^data:/i.test(uri)) {
    return getHashedBufferFromBytes(await readDataUri(uri))
  }

  if (/^https?:\/\//i.test(uri)) {
    return getHashedBufferFromStream(await readHttpUri(uri))
  }

  throw new Error(`Unsupported URI scheme: ${uri}`)
}

function getHashedBufferFromBytes(buffer: Buffer): HashedBuffer {
  const hash = createHash('sha1')
  hash.update(buffer)
  return {buffer, sha1hash: hash.digest('hex')}
}

async function getHashedBufferFromStream(stream: NodeJS.ReadableStream): Promise<HashedBuffer> {
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
    if (stream instanceof Readable) {
      stream.destroy()
    }
  }
}

async function readFileUri(uri: string): Promise<Buffer> {
  const filepath = fileURLToPath(uri)
  const fileHandle = await open(filepath, 'r')

  try {
    return await fileHandle.readFile()
  } finally {
    await fileHandle.close()
  }
}

async function readDataUri(uri: string): Promise<Buffer> {
  const res = await fetch(uri)
  return Buffer.from(await res.arrayBuffer())
}

async function readHttpUri(uri: string): Promise<NodeJS.ReadableStream> {
  const parsed = new URL(uri)
  const res = (await request({stream: true, url: parsed.href})) as GetItResponse
  return res.body
}
