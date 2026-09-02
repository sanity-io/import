import {Readable, Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {deflateSync, gzipSync} from 'node:zlib'

import {expect, test} from 'vitest'

import {maybeUnzip} from '../src/util/maybeUnzip.js'
import {fragmentBuffer} from './helpers/helpers.js'

const payload = Buffer.from('A streaming import payload')

test('passes plain input through unchanged', async () => {
  await expect(collect(Readable.from(['A streaming ', 'import payload']))).resolves.toEqual(payload)
})

test('decompresses gzip input with a fragmented header', async () => {
  await expect(collect(Readable.from(fragmentBuffer(gzipSync(payload), 1)))).resolves.toEqual(
    payload,
  )
})

test('decompresses zlib-deflate input', async () => {
  await expect(collect(Readable.from([deflateSync(payload)]))).resolves.toEqual(payload)
})

test('decompresses up to three nested compression layers', async () => {
  const compressed = gzipSync(deflateSync(gzipSync(payload)))
  await expect(collect(Readable.from([compressed]))).resolves.toEqual(payload)
})

test('rejects more than three nested compression layers', async () => {
  const compressed = gzipSync(gzipSync(gzipSync(gzipSync(payload))))
  await expect(collect(Readable.from([compressed]))).rejects.toThrow('Maximum recursion reached')
})

test('rejects more than three nested compression layers when used in a pipeline', async () => {
  const compressed = gzipSync(gzipSync(gzipSync(gzipSync(payload))))
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })

  await expect(pipeline(Readable.from([compressed]), maybeUnzip, sink)).rejects.toThrow(
    'Maximum recursion reached',
  )
})

test('rejects truncated compressed input', async () => {
  const compressed = gzipSync(payload)
  await expect(collect(Readable.from([compressed.subarray(0, -4)]))).rejects.toThrow()
})

async function collect(source: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of maybeUnzip(source)) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
