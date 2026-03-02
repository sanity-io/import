import {generateHelpUrl} from '@sanity/generate-help-url'
import debug from 'debug'
import pMap from 'p-map'

import {
  type AssetDocument,
  type AssetMetadata,
  type ImportOptions,
  type SanityDocument,
} from './types.js'
import {urlExists} from './util/urlExists.js'

const logger = debug('sanity:import:asset-validation')

const DEFAULT_VERIFY_CONCURRENCY = 12
const REQUIRED_PROPERTIES = {
  _id: 'string',
  _type: 'string',
  assetId: 'string',
  extension: 'string',
  mimeType: 'string',
  path: 'string',
  sha1hash: 'string',
  size: 'number',
  url: 'string',
} as const

export async function validateAssetDocuments(
  docs: SanityDocument[],
  options: ImportOptions,
): Promise<void> {
  const {targetDataset, targetProjectId} = options
  const concurrency = options.assetVerificationConcurrency || DEFAULT_VERIFY_CONCURRENCY

  const assetDocs = docs.filter((doc) =>
    /^sanity\.[a-zA-Z]+Asset$/.test(doc._type || ''),
  ) as AssetDocument[]
  if (assetDocs.length === 0) {
    return
  }

  options.onProgress({step: 'Validating asset documents'})

  for (const doc of assetDocs) validateAssetDocumentProperties(doc)

  // Don't allow assets that reference different datasets (unless explicitly allowing it)
  if (!options.allowAssetsInDifferentDataset) {
    for (const doc of assetDocs) {
      const id = doc._id || doc.url
      const {dataset, projectId} = getLocationFromDocument(doc)
      const resolveText = `See ${generateHelpUrl('import-asset-has-different-target')}`

      if (projectId !== targetProjectId) {
        throw new Error(
          `Asset ${id} references a different project ID than the specified target (asset is in ${projectId}, importing to ${targetProjectId}). ${resolveText}`,
        )
      }

      if (dataset !== targetDataset) {
        throw new Error(
          `Asset ${id} references a different dataset than the specified target (asset is in ${dataset}, importing to ${targetDataset}). ${resolveText}`,
        )
      }
    }
  }

  if (!options.allowFailingAssets) {
    await pMap(assetDocs, ensureAssetUrlExists, {concurrency})
  }
}

function getLocationFromDocument(doc: AssetDocument): {dataset: string; projectId: string} {
  const url = doc.path || doc.url || ''
  const path = url.replace(/^https:\/\/cdn\.sanity\.[a-z]+\//, '')
  const [, projectId, dataset] = path.split('/')
  return {dataset: dataset || '', projectId: projectId || ''}
}

async function ensureAssetUrlExists(assetDoc: AssetDocument): Promise<boolean> {
  const url = assetDoc.url!
  const start = Date.now()
  const exists = await urlExists(url)
  logger(`${url}: %s (%d ms)`, exists ? 'exists' : 'does not exist', Date.now() - start)

  if (!exists) {
    const helpUrl = generateHelpUrl('import-asset-file-does-not-exist')
    throw new Error(
      `Document ${assetDoc._id} points to a URL that does not exist (${url}). See ${helpUrl}.`,
    )
  }

  return true
}

function validateAssetDocumentProperties(assetDoc: AssetDocument): void {
  for (const prop of Object.keys(REQUIRED_PROPERTIES)) {
    const expectedType = REQUIRED_PROPERTIES[prop as keyof typeof REQUIRED_PROPERTIES]
    const propValue = (assetDoc as Record<string, unknown>)[prop]
    if (typeof propValue !== expectedType) {
      const errorType = propValue === undefined ? 'is missing' : 'has invalid type for'

      throw new Error(`Asset document ${assetDoc._id} ${errorType} required property "${prop}"`)
    }
  }

  if (assetDoc._type === 'sanity.imageAsset') {
    validateImageMetadata(assetDoc)
  }
}

function validateImageMetadata(assetDoc: AssetDocument): void {
  if (!assetDoc.metadata) {
    throw new Error(`Asset document ${assetDoc._id} is missing required property "metadata"`)
  }

  if (!assetDoc.metadata.dimensions) {
    throw new Error(
      `Asset document ${assetDoc._id} is missing required property "metadata.dimensions"`,
    )
  }

  const dimensionProps = ['width', 'height', 'aspectRatio']
  const metadata = assetDoc.metadata as AssetMetadata
  for (const prop of dimensionProps) {
    if (typeof metadata.dimensions?.[prop as keyof typeof metadata.dimensions] !== 'number') {
      throw new TypeError(
        `Asset document ${assetDoc._id} is missing required property "metadata.dimensions.${prop}"`,
      )
    }
  }
}
