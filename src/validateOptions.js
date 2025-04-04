const fs = require('fs')
const defaults = require('lodash/defaults')
const noop = require('lodash/noop')

const clientMethods = ['fetch', 'transaction', 'config']
const allowedOperations = ['create', 'createIfNotExists', 'createOrReplace']
const allowedReleasesOperations = ['fail', 'ignore', 'replace']
const defaultOperation = allowedOperations[0]
const defaultReleasesOperation = allowedReleasesOperations[0]

function validateOptions(input, opts) {
  const options = defaults({}, opts, {
    tag: 'sanity.import',
    operation: defaultOperation,
    onProgress: noop,
    allowAssetsInDifferentDataset: false,
    replaceAssets: false,
    skipCrossDatasetReferences: false,
    allowSystemDocuments: false,
    releasesOperation: defaultReleasesOperation,
  })

  if (!isValidInput(input)) {
    throw new Error(
      'Stream does not seem to be a readable stream, an array or a path to a directory',
    )
  }

  if (!options.client) {
    throw new Error('`options.client` must be set to an instance of @sanity/client')
  }

  const missing = clientMethods.find((key) => typeof options.client[key] !== 'function')

  if (missing) {
    throw new Error(
      `\`options.client\` is not a valid @sanity/client instance - no "${missing}" method found`,
    )
  }

  const clientConfig = options.client.config()
  if (!clientConfig.token) {
    throw new Error('Client is not instantiated with a `token`')
  }

  // We don't want `sanity.cli.sanity.import`, so if this is coming from the CLI, unset the prefix
  if (clientConfig.requestTagPrefix === 'sanity.cli' && options.tag === 'sanity.import') {
    options.client.config({requestTagPrefix: undefined})
  }

  if (!allowedOperations.includes(options.operation)) {
    throw new Error(`Operation "${options.operation}" is not supported`)
  }

  if (!allowedReleasesOperations.includes(options.releasesOperation)) {
    throw new Error(`Releases operation "${options.releasesOperation}" is not supported`)
  }

  if (options.assetConcurrency && options.assetConcurrency > 12) {
    throw new Error('`assetConcurrency` must be <= 12')
  }

  if (typeof options.tag !== 'string' || !/^[a-z0-9._-]{1,75}$/i.test(options.tag)) {
    throw new Error(
      `Tag can only contain alphanumeric characters, underscores, dashes and dots, and be between one and 75 characters long.`,
    )
  }

  options.targetProjectId = clientConfig.projectId
  options.targetDataset = clientConfig.dataset

  return options
}

function isValidInput(input) {
  if (!input) {
    return false
  }

  if (typeof input.pipe === 'function') {
    return true
  }

  if (Array.isArray(input)) {
    return true
  }

  if (typeof input === 'string' && isDirectory(input)) {
    return true
  }

  return false
}

function isDirectory(path) {
  try {
    // eslint-disable-next-line no-sync
    const stats = fs.statSync(path)
    return stats.isDirectory()
  } catch (err) {
    return false
  }
}

module.exports = validateOptions
