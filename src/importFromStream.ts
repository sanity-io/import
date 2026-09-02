import {mkdirSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'

import {createDebug} from 'obug'
import {x as extractTar} from 'tar'

import {type ImportOptions, type ImportResult, type SanityDocument} from './types.js'
import {getJsonStreamer} from './util/getJsonStreamer.js'
import {globFiles} from './util/globFiles.js'
import {isTar, tarHeaderLength} from './util/isTar.js'
import {maybeUnzip} from './util/maybeUnzip.js'

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
  private bufferedChunks: Buffer[] = []
  private bufferedBytes = 0
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
      this.finishTarget(this.targetStream, callback)
      return
    }

    const buffered = this.consumeBufferedChunks()
    const targetStream = this.initializeTarget(buffered)
    this.writeToTarget(targetStream, buffered, (error) => {
      if (error) {
        callback(error)
        return
      }
      this.finishTarget(targetStream, callback)
    })
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (this.targetStream) {
      this.writeToTarget(this.targetStream, chunk, callback)
      return
    }

    this.bufferedChunks.push(chunk)
    this.bufferedBytes += chunk.length

    if (this.bufferedBytes < tarHeaderLength) {
      callback()
      return
    }

    const buffered = this.consumeBufferedChunks()
    const targetStream = this.initializeTarget(buffered)
    this.writeToTarget(targetStream, buffered, callback)
  }

  private consumeBufferedChunks(): Buffer {
    const buffered = Buffer.concat(this.bufferedChunks, this.bufferedBytes)
    this.bufferedChunks = []
    this.bufferedBytes = 0
    return buffered
  }

  private initializeTarget(firstBytes: Buffer): NodeJS.WritableStream {
    let targetStream: NodeJS.WritableStream

    if (isTar(firstBytes)) {
      debug('Stream is a tarball, extracting to %s', this.outputPath)
      this.isTarFile = true
      mkdirSync(this.outputPath, {recursive: true})
      targetStream = extractTar({cwd: this.outputPath})
    } else {
      debug('Stream is an ndjson file, streaming JSON')
      const jsonStreamer = getJsonStreamer({
        allowReplacementCharacters: this.options.allowReplacementCharacters,
      })
      targetStream = jsonStreamer

      jsonStreamer.on('data', (doc: SanityDocument) => {
        this.jsonDocuments.push(doc)
      })
    }

    targetStream.on('error', (err: Error) => {
      this.destroy(err)
    })
    this.targetStream = targetStream
    return targetStream
  }

  private writeToTarget(
    targetStream: NodeJS.WritableStream,
    chunk: Buffer,
    callback: (error?: Error | null) => void,
  ): void {
    if (targetStream.write(chunk)) {
      callback()
    } else {
      targetStream.once('drain', callback)
    }
  }

  private finishTarget(
    targetStream: NodeJS.WritableStream,
    callback: (error?: Error | null) => void,
  ): void {
    targetStream.once('finish', callback)
    targetStream.end()
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
    await pipeline(stream, maybeUnzip, router)

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

  // Exports are typically `<export-name>/data.ndjson`, so only look a couple of levels deep
  const files = await globFiles(['*.ndjson', '*/*.ndjson', '*/*/*.ndjson'], outputPath)
  if (files.length === 0) {
    throw new Error('ndjson-file not found in tarball')
  }

  const importBaseDir = path.dirname(files[0]!)
  return importers.fromFolder(importBaseDir, {...options, deleteOnComplete: true}, importers)
}
