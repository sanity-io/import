import os from 'node:os'
import path from 'node:path'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'

import createDebug from 'debug'
import gunzipMaybe from 'gunzip-maybe'
import tar from 'tar-fs'
import {glob} from 'tinyglobby'

import {type ImportOptions, type ImportResult, type SanityDocument} from './types.js'
import {getJsonStreamer} from './util/getJsonStreamer.js'
import {isTar} from './util/isTar.js'

const debug = createDebug('sanity:import:stream')

interface ImportersContext {
  fromArray: (documents: SanityDocument[], options: ImportOptions) => Promise<ImportResult>
  fromFolder: (
    fromDir: string,
    options: ImportOptions & {deleteOnComplete?: boolean},
    importers: ImportersContext,
  ) => Promise<ImportResult>
  fromStream: (
    stream: NodeJS.ReadableStream,
    options: ImportOptions,
    importers: ImportersContext,
  ) => Promise<ImportResult>
}

// StreamRouter handles the peek functionality and routes to appropriate handler
class StreamRouter extends Transform {
  private firstChunk: Buffer | null = null
  private isTarFile = false
  private jsonDocuments: SanityDocument[] = []
  private options: ImportOptions
  private outputPath: string
  private targetStream: NodeJS.WritableStream | null = null

  constructor(outputPath: string, options: ImportOptions) {
    super()
    this.outputPath = outputPath
    this.options = options
  }

  get documents(): SanityDocument[] {
    return this.jsonDocuments
  }

  get isTar(): boolean {
    return this.isTarFile
  }

  _flush(callback: (error?: Error | null) => void) {
    if (this.targetStream) {
      this.targetStream.end()
      this.targetStream.on('finish', callback)
      this.targetStream.on('error', callback)
    } else {
      callback()
    }
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (!this.firstChunk) {
      this.firstChunk = chunk

      // Determine file type from first chunk
      if (isTar(chunk)) {
        debug('Stream is a tarball, extracting to %s', this.outputPath)
        this.isTarFile = true
        // tar.extract returns a writable stream for extracting files
        this.targetStream = tar.extract(this.outputPath)
      } else {
        debug('Stream is an ndjson file, streaming JSON')
        this.isTarFile = false
        const jsonStreamer = getJsonStreamer({
          allowReplacementCharacters: this.options.allowReplacementCharacters,
        })
        this.targetStream = jsonStreamer

        // Collect documents as they're parsed
        jsonStreamer.on('data', (doc: SanityDocument) => {
          this.jsonDocuments.push(doc)
        })
      }

      // Set up error handling
      if (this.targetStream) {
        this.targetStream.on('error', (err: Error) => {
          this.emit('error', err)
        })
      }
    }

    if (this.targetStream) {
      const written = this.targetStream.write(chunk)
      if (written) {
        callback()
      } else {
        this.targetStream.once('drain', callback)
      }
    } else {
      callback(new Error('Target stream not initialized'))
    }
  }
}

export async function importFromStream(
  stream: NodeJS.ReadableStream,
  options: ImportOptions,
  importers: ImportersContext,
): Promise<ImportResult> {
  const slugDate = new Date()
    .toISOString()
    .replaceAll(/[^a-z0-9]/gi, '-')
    .toLowerCase()

  const outputPath = path.join(os.tmpdir(), `sanity-import-${slugDate}`)
  debug('Importing from stream')

  const router = new StreamRouter(outputPath, options)

  try {
    // gunzipMaybe is an untyped library

    await pipeline(stream, gunzipMaybe(), router)

    if (router.isTar) {
      return await findAndImportFromTar(outputPath, options, importers)
    }
    return await importers.fromArray(router.documents, options)
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

async function findAndImportFromTar(
  outputPath: string,
  options: ImportOptions,
  importers: ImportersContext,
): Promise<ImportResult> {
  debug('Tarball extracted, looking for ndjson')

  const files = await glob(['**/*.ndjson'], {absolute: true, cwd: outputPath, deep: 2})
  if (files.length === 0) {
    throw new Error('ndjson-file not found in tarball')
  }

  const importBaseDir = path.dirname(files[0]!)
  return importers.fromFolder(importBaseDir, {...options, deleteOnComplete: true}, importers)
}
