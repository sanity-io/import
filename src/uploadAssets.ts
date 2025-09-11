import {basename} from 'node:path'
import {parse as parseUrl} from 'node:url'

import {isSanityImageUrl} from '@sanity/asset-utils'
import type {SanityClient, Transaction} from '@sanity/client'
import debug from 'debug'
import pMap from 'p-map'

import type {AssetFailure, AssetUploadError, ImportOptions, SanityFetchResponse} from './types.js'
import {getHashedBufferForUri} from './util/getHashedBufferForUri.js'
import {progressStepper} from './util/progressStepper.js'
import {retryOnFailure} from './util/retryOnFailure.js'
import {suffixTag} from './util/suffixTag.js'
import {urlExists} from './util/urlExists.js'

const logger = debug('sanity:import')

const ASSET_UPLOAD_CONCURRENCY = 8
const ASSET_PATCH_CONCURRENCY = 30
const ASSET_PATCH_BATCH_SIZE = 50
const ASSET_PATCH_BATCH_TASK_SIZE = 1000

export interface AssetRef {
  documentId: string
  path: string
  url: string
  type: string
}

export interface AssetRefMapItem {
  documentId: string
  path: string
}

export interface UploadAssetsResult {
  batches: number
  failures: AssetFailure[]
}

interface AssetData {
  buffer: Buffer
  sha1hash: string
  type: string
  url: string
}

interface DocumentTasks {
  documentId: string
  tasks: Array<{path: string; assetId: string}>
}

export async function uploadAssets(
  assets: AssetRef[],
  options: ImportOptions,
): Promise<UploadAssetsResult> {
  const concurrency = options.assetConcurrency || ASSET_UPLOAD_CONCURRENCY
  logger('Uploading assets with a concurrency of %d', concurrency)

  // Build a Map where the keys are `type#url` and the value is an array of all
  // objects containing document id and path to inject asset reference to.
  // `assets` is an array of objects with shape: {documentId, path, url, type}
  const assetRefMap = getAssetRefMap(assets)

  // We might have additional assets that is not referenced by any documents, but was part of a
  // dataset when exporting, for instance. Add these to the map without any references to update.
  const unreferencedAssets = options.unreferencedAssets || []
  unreferencedAssets.forEach((asset) => {
    if (!assetRefMap.has(asset)) {
      assetRefMap.set(asset, [])
    }
  })

  if (assetRefMap.size === 0) {
    return {
      batches: 0,
      failures: [],
    }
  }

  // Create a function we can call for every completed upload to report progress
  const progress = progressStepper(options.onProgress, {
    step: 'Importing assets (files/images)',
    total: assetRefMap.size,
  })

  // If we should allow failures, we need to use a custom catch handler in order
  // to not set the asset references for the broken assets
  const ensureAssetExists = ensureAssetWithRetries.bind(null, options, progress)
  const ensureMethod = options.allowFailingAssets
    ? (assetKey: string, i: number) => ensureAssetExists(assetKey, i).catch((err: Error) => err)
    : ensureAssetExists

  // Loop over all unique URLs and ensure they exist, and if not, upload them
  const mapOptions = {concurrency}
  const assetIds = await pMap(assetRefMap.keys(), ensureMethod, mapOptions)

  // Extract a list of all failures so we may report them and possibly retry them later
  const assetFailures = getUploadFailures(assetRefMap, assetIds)

  // Loop over all documents that need asset references to be set
  const batches = await setAssetReferences(assetRefMap, assetIds, options)
  return {
    batches: batches.reduce((prev, add) => prev + add, 0),
    failures: assetFailures,
  }
}

function getAssetRefMap(assets: AssetRef[]): Map<string, AssetRefMapItem[]> {
  return assets.reduce((assetRefMap, item) => {
    const {documentId, path, url, type} = item
    const key = `${type}#${url}`
    let refs = assetRefMap.get(key)
    if (!refs) {
      refs = []
      assetRefMap.set(key, refs)
    }

    refs.push({documentId, path})
    return assetRefMap
  }, new Map<string, AssetRefMapItem[]>())
}

async function ensureAssetWithRetries(
  options: ImportOptions,
  progress: () => void,
  assetKey: string,
  i: number,
): Promise<string> {
  const [type, url] = assetKey.split('#', 2)

  const {buffer, sha1hash} = await retryOnFailure(() => downloadAsset(url!, i)).catch(
    (err: Error) => {
      progress()
      const assetError = err as AssetUploadError
      assetError.type = type!
      assetError.url = url!
      assetError.message = assetError.message.includes(url!)
        ? assetError.message
        : `Failed to download ${type} @ ${url}:\n${assetError.message}`

      throw assetError
    },
  )

  const asset = {buffer, sha1hash, type: type!, url: url!}
  return retryOnFailure(() => ensureAsset(asset, options, i))
    .then((result: string) => {
      progress()
      return result
    })
    .catch((err: Error) => {
      progress()
      const assetError = err as AssetUploadError
      assetError.type = type!
      assetError.url = url!
      assetError.message = assetError.message.includes(url!)
        ? assetError.message
        : `Failed to upload ${type} @ ${url}:\n${assetError.message}`

      throw assetError
    })
}

function downloadAsset(url: string, i: number): Promise<{buffer: Buffer; sha1hash: string}> {
  // Download the asset in order for us to create a hash
  logger('[Asset #%d] Downloading %s', i, url)
  return getHashedBufferForUri(url)
}

async function ensureAsset(asset: AssetData, options: ImportOptions, i: number): Promise<string> {
  const {buffer, sha1hash, type, url} = asset
  const {client, assetMap = {}, replaceAssets, tag} = options

  // See if the item exists on the server
  if (!replaceAssets) {
    logger('[Asset #%d] Checking for asset with hash %s', i, sha1hash)
    const assetDocId = await getAssetDocumentIdForHash(
      client,
      type,
      sha1hash,
      0,
      suffixTag(tag, 'asset.get-id'),
    )

    if (assetDocId) {
      // Same hash means we want to reuse the asset
      logger('[Asset #%d] Found %s for hash %s', i, type, sha1hash)
      return assetDocId
    }
  }

  const assetMeta = assetMap[`${type}-${sha1hash}`]
  const hasFilename = assetMeta && assetMeta.originalFilename
  const hasNonFilenameMeta = assetMeta && Object.keys(assetMap).length > 1
  const {pathname} = parseUrl(url)
  const filename = hasFilename ? assetMeta.originalFilename : basename(pathname || '')

  // If it doesn't exist, we want to upload it
  logger('[Asset #%d] Uploading %s with URL %s', i, type, url)
  const uploadOptions: {tag: string; filename?: string} = {
    tag: suffixTag(tag, 'asset.upload'),
  }
  if (filename) {
    uploadOptions.filename = filename
  }

  const assetDoc = await client.assets.upload(type as 'file' | 'image', buffer, uploadOptions)

  // If we have more metadata to provide, update the asset document
  if (hasNonFilenameMeta) {
    await client
      .patch(assetDoc._id)
      .set(assetMeta)
      .commit({visibility: 'async', tag: suffixTag(tag, 'asset.add-meta')})
  }

  return assetDoc._id
}

async function getAssetDocumentIdForHash(
  client: SanityClient,
  type: string,
  sha1hash: string,
  attemptNum: number,
  tag: string,
): Promise<string | null> {
  // eslint-disable-next-line no-warning-comments
  // @todo remove retry logic when client has reintroduced it
  try {
    const dataType = type === 'file' ? 'sanity.fileAsset' : 'sanity.imageAsset'
    const query = '*[_type == $dataType && sha1hash == $sha1hash][0]{_id, url}'
    const assetDoc: SanityFetchResponse | null = await client.fetch(
      query,
      {dataType, sha1hash},
      {tag},
    )
    if (!assetDoc || !assetDoc.url) {
      return null
    }

    // By adding `fm=json` to image requests, we do a slightly cheaper operation
    const assetUrl = isSanityImageUrl(assetDoc.url) ? `${assetDoc.url}?fm=json` : assetDoc.url
    const exists = await urlExists(assetUrl)
    if (!exists) {
      logger(`Asset document ${assetDoc._id} exists, but file does not. Overwriting.`)
      return null
    }

    return assetDoc._id
  } catch (err) {
    if (attemptNum < 3) {
      return getAssetDocumentIdForHash(client, type, sha1hash, attemptNum + 1, tag)
    }

    const errorWithAttempts = err as AssetUploadError
    errorWithAttempts.attempts = attemptNum
    throw new Error(`Error while attempt to query Sanity API:\n${errorWithAttempts.message}`)
  }
}

function getUploadFailures(
  assetRefMap: Map<string, AssetRefMapItem[]>,
  assetIds: (string | Error)[],
): AssetFailure[] {
  const lookup = assetRefMap.values()

  return assetIds.reduce((failures: AssetFailure[], assetId) => {
    const documents = lookup.next().value
    if (typeof assetId === 'string') {
      return failures
    }

    const errorWithUrl = assetId as AssetUploadError
    return failures.concat({
      type: 'asset',
      url: errorWithUrl.url,
      documents: documents
        ? documents.map(({documentId, path}) => ({
            documentId,
            path,
          }))
        : [],
    })
  }, [])
}

function setAssetReferences(
  assetRefMap: Map<string, AssetRefMapItem[]>,
  assetIds: (string | Error)[],
  options: ImportOptions,
): Promise<number[]> {
  const {client, tag} = options
  const lookup = assetRefMap.values()

  // Collects patch tasks per document to avoid patching the same document multiple times
  const patchTasksPerDoc: Record<string, Array<{path: string; assetId: string}>> = assetIds.reduce(
    (tasks: Record<string, Array<{path: string; assetId: string}>>, assetId) => {
      const documents = lookup.next().value
      if (typeof assetId !== 'string') {
        return tasks
      }

      if (documents) {
        documents.forEach(({documentId, path}) => {
          tasks[documentId] = tasks[documentId] || []
          tasks[documentId].push({path, assetId})
        })
      }
      return tasks
    },
    {},
  )

  const patchTasks: DocumentTasks[] = Object.entries(patchTasksPerDoc).map(
    ([documentId, tasks]) => ({
      documentId,
      tasks,
    }),
  )

  // We now have an array of tasks per document, each containing:
  // {documentId: string, tasks: [{path, assetId}]}
  // Instead of doing a single mutation per document, let's batch  them up
  const batches = patchTasks.reduce((acc: DocumentTasks[][], task) => {
    if (acc.length === 0) {
      return [[task]]
    }

    const currentBatch = acc[acc.length - 1]!
    const overallSize = currentBatch.reduce(
      (prev: number, add) => prev + (add.tasks ? add.tasks.length : 0),
      0,
    )

    if (
      overallSize + task.tasks.length > ASSET_PATCH_BATCH_TASK_SIZE ||
      currentBatch.length >= ASSET_PATCH_BATCH_SIZE
    ) {
      // Create a new batch if the current one is full
      acc.push([task])
      return acc
    }

    currentBatch.push(task)
    return acc
  }, [])

  if (batches.length === 0) {
    return Promise.resolve([0])
  }

  // Since separate progress step for batches of reference sets
  const progress = progressStepper(options.onProgress, {
    step: 'Setting asset references to documents',
    total: batches.length,
  })

  // Now perform the batch operations in parallel with a given concurrency
  const mapOptions = {concurrency: ASSET_PATCH_CONCURRENCY}
  const setAssetRefs = setAssetReferenceBatch.bind(null, client, progress, tag)
  return pMap(batches, setAssetRefs, mapOptions)
}

function setAssetReferenceBatch(
  client: SanityClient,
  progress: () => void,
  tag: string,
  batch: DocumentTasks[],
): Promise<number> {
  logger('Setting asset references on %d documents', batch.length)
  return retryOnFailure(() =>
    batch
      .reduce(reducePatch, client.transaction())
      .commit({visibility: 'async', tag: suffixTag(tag, 'asset.set-refs')})
      .then(progress)
      .then(() => batch.reduce((prev, add) => prev + add.tasks.length, 0)),
  )
}

function getAssetType(assetId: string): string {
  return assetId.slice(0, assetId.indexOf('-'))
}

function reducePatch(trx: Transaction, documentTasks: DocumentTasks): Transaction {
  return trx.patch(documentTasks.documentId, (patch) => {
    documentTasks.tasks.forEach((task) =>
      patch
        .setIfMissing({
          [task.path]: {_type: getAssetType(task.assetId)},
        })
        .set({
          [`${task.path}.asset`]: {
            _type: 'reference',
            _ref: task.assetId,
          },
        }),
    )
    return patch
  })
}
