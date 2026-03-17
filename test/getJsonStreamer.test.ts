import {PassThrough} from 'node:stream'

import {describe, expect, test} from 'vitest'

import {getJsonStreamer} from '../src/util/getJsonStreamer.js'

function collect(stream: NodeJS.ReadWriteStream): Promise<unknown[]> {
  const results: unknown[] = []
  stream.on('data', (doc) => results.push(doc))
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve(results))
    stream.on('error', reject)
  })
}

describe('getJsonStreamer', () => {
  test('parses single ndjson line', async () => {
    const streamer = getJsonStreamer()
    const input = new PassThrough()
    const resultPromise = collect(streamer)

    input.pipe(streamer)
    input.end('{"_id": "doc1", "_type": "test"}\n')

    const docs = await resultPromise
    expect(docs).toEqual([{_id: 'doc1', _type: 'test'}])
  })

  test('parses multiple ndjson lines', async () => {
    const streamer = getJsonStreamer()
    const input = new PassThrough()
    const resultPromise = collect(streamer)

    input.pipe(streamer)
    input.end('{"_id": "a", "_type": "t"}\n{"_id": "b", "_type": "t"}\n')

    const docs = await resultPromise
    expect(docs).toEqual([
      {_id: 'a', _type: 't'},
      {_id: 'b', _type: 't'},
    ])
  })

  test('handles line split across chunks', async () => {
    const streamer = getJsonStreamer()
    const input = new PassThrough()
    const resultPromise = collect(streamer)

    input.pipe(streamer)
    input.write('{"_id": "do')
    input.write('c1", "_type": "test"}\n')
    input.end()

    const docs = await resultPromise
    expect(docs).toEqual([{_id: 'doc1', _type: 'test'}])
  })

  test('handles multi-byte utf-8 character split across chunks', async () => {
    const streamer = getJsonStreamer()
    const resultPromise = collect(streamer)

    // "🎉" is U+1F389, encoded as 4 bytes in UTF-8: F0 9F 8E 89
    const line = '{"_id": "doc1", "_type": "test", "title": "party 🎉"}\n'
    const buf = Buffer.from(line, 'utf8')

    // Find the emoji bytes and split in the middle of it
    const emojiOffset = buf.indexOf(Buffer.from('🎉', 'utf8'))
    const splitPoint = emojiOffset + 2 // split between bytes 2 and 3 of the 4-byte sequence

    streamer.write(buf.subarray(0, splitPoint))
    streamer.write(buf.subarray(splitPoint))
    streamer.end()

    const docs = await resultPromise
    expect(docs).toEqual([{_id: 'doc1', _type: 'test', title: 'party 🎉'}])
  })

  test('handles 3-byte utf-8 character split across chunks', async () => {
    const streamer = getJsonStreamer()
    const resultPromise = collect(streamer)

    // "€" is U+20AC, encoded as 3 bytes in UTF-8: E2 82 AC
    const line = '{"_id": "doc1", "_type": "test", "price": "€100"}\n'
    const buf = Buffer.from(line, 'utf8')

    const euroOffset = buf.indexOf(Buffer.from('€', 'utf8'))
    const splitPoint = euroOffset + 1 // split after first byte of the 3-byte sequence

    streamer.write(buf.subarray(0, splitPoint))
    streamer.write(buf.subarray(splitPoint))
    streamer.end()

    const docs = await resultPromise
    expect(docs).toEqual([{_id: 'doc1', _type: 'test', price: '€100'}])
  })

  test('handles last line without trailing newline', async () => {
    const streamer = getJsonStreamer()
    const resultPromise = collect(streamer)

    streamer.write('{"_id": "doc1", "_type": "test"}\n')
    streamer.write('{"_id": "doc2", "_type": "test"}')
    streamer.end()

    const docs = await resultPromise
    expect(docs).toEqual([
      {_id: 'doc1', _type: 'test'},
      {_id: 'doc2', _type: 'test'},
    ])
  })

  test('skips empty lines', async () => {
    const streamer = getJsonStreamer()
    const resultPromise = collect(streamer)

    streamer.end('{"_id": "a", "_type": "t"}\n\n{"_id": "b", "_type": "t"}\n')

    const docs = await resultPromise
    expect(docs).toEqual([
      {_id: 'a', _type: 't'},
      {_id: 'b', _type: 't'},
    ])
  })

  test('emits error for invalid JSON', async () => {
    const streamer = getJsonStreamer()

    const errorPromise = new Promise<Error>((resolve) => {
      streamer.on('error', resolve)
    })

    streamer.write('not json\n')

    const error = await errorPromise
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('Failed to parse line #1')
    expect(error.message).toContain('valid ndjson')
  })
})
