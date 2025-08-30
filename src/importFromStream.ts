import createDebug from 'debug'
import fs from 'fs'
// @ts-expect-error - no type definitions available
import gunzipMaybe from 'gunzip-maybe'
// @ts-expect-error - no type definitions available
import isTar from 'is-tar'
import {noop} from 'lodash-es'
import miss from 'mississippi'
import os from 'os'
import path from 'path'
// @ts-expect-error - no type definitions available
import peek from 'peek-stream'
// @ts-expect-error - no type definitions available
import tar from 'tar-fs'
import {glob} from 'tinyglobby'

import type {ImportOptions, ImportResult, SanityDocument} from './types.js'
import getJsonStreamer from './util/getJsonStreamer.js'

const debug = createDebug('sanity:import:stream')

interface ImportersContext {
  fromStream: (
    stream: NodeJS.ReadableStream,
    options: ImportOptions,
    importers: ImportersContext,
  ) => Promise<ImportResult>
  fromArray: (documents: SanityDocument[], options: ImportOptions) => Promise<ImportResult>
  fromFolder: (
    fromDir: string,
    options: ImportOptions & {deleteOnComplete?: boolean},
    importers: ImportersContext,
  ) => Promise<ImportResult>
}

export default function importFromStream(
  stream: NodeJS.ReadableStream,
  options: ImportOptions,
  importers: ImportersContext,
): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const slugDate = new Date()
      .toISOString()
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase()

    const outputPath = path.join(os.tmpdir(), `sanity-import-${slugDate}`)
    debug('Importing from stream')

    let isTarStream = false
    let jsonDocuments: SanityDocument[]

    const uncompressStream = (miss as any).pipeline(gunzipMaybe(), untarMaybe())
    ;(miss as any).pipe(stream, uncompressStream, (err: any) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }

      if (isTarStream) {
        findAndImport().catch(reject)
      } else {
        resolve(importers.fromArray(jsonDocuments, options))
      }
    })

    function untarMaybe() {
      return peek({newline: false, maxBuffer: 300}, (data: any, swap: any) => {
        if (isTar(data)) {
          debug('Stream is a tarball, extracting to %s', outputPath)
          isTarStream = true
          return swap(null, tar.extract(outputPath))
        }

        debug('Stream is an ndjson file, streaming JSON')
        const jsonStreamer = getJsonStreamer()
        const concatter = (miss as any).concat(resolveNdjsonStream)
        const ndjsonStream = (miss as any).pipeline(jsonStreamer, concatter)
        ndjsonStream.on('error', (err: any) => {
          uncompressStream.emit('error', err)
          destroy([uncompressStream, jsonStreamer, concatter, ndjsonStream])
          reject(err instanceof Error ? err : new Error(String(err)))
        })
        return swap(null, ndjsonStream)
      })
    }

    function resolveNdjsonStream(documents: SanityDocument[]) {
      debug('Finished reading ndjson stream')
      jsonDocuments = documents
    }

    async function findAndImport() {
      debug('Tarball extracted, looking for ndjson')

      const files = await glob(['**/*.ndjson'], {cwd: outputPath, deep: 2, absolute: true})
      if (!files.length) {
        reject(new Error('ndjson-file not found in tarball'))
        return
      }

      const importBaseDir = path.dirname(files[0]!)
      resolve(importers.fromFolder(importBaseDir, {...options, deleteOnComplete: true}, importers))
    }
  })
}

function destroy(streams: any[]) {
  streams.forEach((stream) => {
    if (isFS(stream)) {
      // use close for fs streams to avoid fd leaks
      stream.close(noop)
    } else if (isRequest(stream)) {
      // request.destroy just do .end - .abort is what we want
      stream.abort()
    } else if (isFn(stream.destroy)) {
      stream.destroy()
    }
  })
}

function isFn(fn: any): fn is (...args: any[]) => any {
  return typeof fn === 'function'
}

function isFS(stream: any): stream is fs.ReadStream | fs.WriteStream {
  return (
    (stream instanceof (fs.ReadStream || noop) || stream instanceof (fs.WriteStream || noop)) &&
    isFn(stream.close)
  )
}

function isRequest(stream: any): stream is {setHeader: any; abort: () => void} {
  return stream.setHeader && isFn(stream.abort)
}
