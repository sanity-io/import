import fs from 'node:fs'
import {rm} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

import {createDebug} from 'obug'

import {
  type AssetMap,
  type ImportersContext,
  type ImportOptions,
  type ImportResult,
} from './types.js'
import {globFiles} from './util/globFiles.js'
import {readJson} from './util/readJson.js'

const debug = createDebug('sanity:import:folder')

export async function importFromFolder(
  fromDir: string,
  options: ImportOptions,
  importers: ImportersContext,
): Promise<ImportResult> {
  debug('Importing from folder %s', fromDir)
  const dataFiles = await globFiles('*.ndjson', fromDir)
  if (dataFiles.length === 0) {
    throw new Error(`No .ndjson file found in ${fromDir}`)
  }

  if (dataFiles.length > 1) {
    throw new Error(`More than one .ndjson file found in ${fromDir} - only one is supported`)
  }

  const assetMap = await readJson<AssetMap>(path.join(fromDir, 'assets.json')).catch(
    () => ({}) as AssetMap,
  )

  const dataFile = dataFiles[0]
  debug('Importing from file %s', dataFile)

  const stream = fs.createReadStream(dataFile!)
  const images = await globFiles('images/*', fromDir)
  const files = await globFiles('files/*', fromDir)
  const imageAssets = images.map((imgPath: string) => `image#${pathToFileURL(imgPath).href}`)
  const fileAssets = files.map((filePath: string) => `file#${pathToFileURL(filePath).href}`)
  const unreferencedAssets: string[] = [...imageAssets, ...fileAssets]

  debug('Queueing %d assets', unreferencedAssets.length)

  const streamOptions = {...options, assetMap, assetsBase: fromDir, unreferencedAssets}
  const result = await importers.fromStream(stream, streamOptions, importers)

  if (options.deleteOnComplete) {
    await rm(fromDir, {force: true, recursive: true})
  }

  return result
}
