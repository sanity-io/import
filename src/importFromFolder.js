const fs = require('fs')
const path = require('path')
const debug = require('debug')('sanity:import:folder')
const getFileUrl = require('file-url')
const {glob} = require('tinyglobby')
const readJson = require('./util/readJson')
const rimraf = require('./util/rimraf')

module.exports = async function importFromFolder(fromDir, options, importers) {
  debug('Importing from folder %s', fromDir)
  const dataFiles = await glob(['*.ndjson'], {cwd: fromDir, absolute: true})
  if (dataFiles.length === 0) {
    throw new Error(`No .ndjson file found in ${fromDir}`)
  }

  if (dataFiles.length > 1) {
    throw new Error(`More than one .ndjson file found in ${fromDir} - only one is supported`)
  }

  const assetMap = await readJson(path.join(fromDir, 'assets.json')).catch(() => ({}))

  const dataFile = dataFiles[0]
  debug('Importing from file %s', dataFile)

  const stream = fs.createReadStream(dataFile)
  const images = await glob('images/*', {cwd: fromDir, absolute: true})
  const files = await glob('files/*', {cwd: fromDir, absolute: true})
  const unreferencedAssets = []
    .concat(images.map((imgPath) => `image#${getFileUrl(imgPath, {resolve: false})}`))
    .concat(files.map((filePath) => `file#${getFileUrl(filePath, {resolve: false})}`))

  debug('Queueing %d assets', unreferencedAssets.length)

  const streamOptions = {...options, unreferencedAssets, assetsBase: fromDir, assetMap}
  const result = await importers.fromStream(stream, streamOptions, importers)

  if (options.deleteOnComplete) {
    await rimraf(fromDir)
  }

  return result
}
