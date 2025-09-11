import fs from 'node:fs'

import {defaults, noop} from 'lodash-es'

import type {ImportOptions, ImportSource} from './types.js'

const clientMethods = ['fetch', 'transaction', 'config'] as const
const allowedOperations = ['create', 'createIfNotExists', 'createOrReplace'] as const
const allowedReleasesOperations = ['fail', 'ignore', 'replace'] as const
const defaultOperation = allowedOperations[0]
const defaultReleasesOperation = allowedReleasesOperations[0]

export function validateOptions(input: ImportSource, opts: Partial<ImportOptions>): ImportOptions {
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
      'Input does not seem to be a readable stream, an array or a path to a directory',
    )
  }

  if (!options.client) {
    throw new Error('`options.client` must be set to an instance of @sanity/client')
  }

  const missing = clientMethods.find((key) => typeof options.client?.[key] !== 'function')

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
    const newConfig = {...clientConfig}
    delete newConfig.requestTagPrefix
    options.client = options.client.withConfig(newConfig)
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

  if (clientConfig.projectId) {
    options.targetProjectId = clientConfig.projectId
  }
  if (clientConfig.dataset) {
    options.targetDataset = clientConfig.dataset
  }

  return options as ImportOptions
}

function isValidInput(input: ImportSource): boolean {
  if (!input) {
    return false
  }

  if (
    typeof input === 'object' &&
    input !== null &&
    'pipe' in input &&
    typeof input.pipe === 'function'
  ) {
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

function isDirectory(path: string): boolean {
  try {
    const stats = fs.statSync(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}
