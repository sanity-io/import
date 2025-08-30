import createDebug from 'debug'
import getFileUrl from 'file-url'
import fs from 'fs'
import path from 'path'
import {glob} from 'tinyglobby'

import type {AssetMap, ImportOptions, ImportResult} from './types.js'
import readJson from './util/readJson.js'
import rimraf from './util/rimraf.js'

const debug = createDebug('sanity:import:folder')

interface ImportersContext {
  fromStream: (
    stream: NodeJS.ReadableStream,
    options: ImportOptions,
    importers: ImportersContext,
  ) => Promise<ImportResult>
  fromArray: (documents: any[], options: ImportOptions) => Promise<ImportResult>
  fromFolder: (
    fromDir: string,
    options: ImportOptions,
    importers: ImportersContext,
  ) => Promise<ImportResult>
}

export default async function importFromFolder(
  fromDir: string,
  options: ImportOptions,
  importers: ImportersContext,
): Promise<ImportResult> {
  debug('Importing from folder %s', fromDir)
  const dataFiles = await glob(['*.ndjson'], {cwd: fromDir, absolute: true})
  if (dataFiles.length === 0) {
    throw new Error(`No .ndjson file found in ${fromDir}`)
  }

  if (dataFiles.length > 1) {
    throw new Error(`More than one .ndjson file found in ${fromDir} - only one is supported`)
  }

  const assetMap = await readJson(path.join(fromDir, 'assets.json')).catch(() => ({}) as AssetMap)

  const dataFile = dataFiles[0]
  debug('Importing from file %s', dataFile)

  const stream = fs.createReadStream(dataFile!)
  const images = await glob('images/*', {cwd: fromDir, absolute: true})
  const files = await glob('files/*', {cwd: fromDir, absolute: true})
  const imageAssets = images.map(
    (imgPath: string) => `image#${getFileUrl(imgPath, {resolve: false})}`,
  )
  const fileAssets = files.map(
    (filePath: string) => `file#${getFileUrl(filePath, {resolve: false})}`,
  )
  const unreferencedAssets: string[] = [...imageAssets, ...fileAssets]

  debug('Queueing %d assets', unreferencedAssets.length)

  const streamOptions = {...options, unreferencedAssets, assetsBase: fromDir, assetMap}
  const result = await importers.fromStream(stream, streamOptions, importers)

  if (options.deleteOnComplete) {
    await rimraf(fromDir)
  }

  return result
}
