import createDebug from 'debug'
import {flatten} from 'lodash-es'

import {absolutifyPaths, getAssetRefs, unsetAssetRefs} from './assetRefs.js'
import {assignArrayKeys} from './assignArrayKeys.js'
import {assignDocumentId} from './assignDocumentId.js'
import {batchDocuments} from './batchDocuments.js'
import {documentHasError} from './documentHasErrors.js'
import {importBatches} from './importBatches.js'
import type {StrongRefsTask} from './references.js'
import {
  cleanupReferences,
  getStrongRefs,
  strengthenReferences,
  weakenStrongRefs,
} from './references.js'
import type {ImportOptions, ImportResult, SanityDocument} from './types.js'
import {uploadAssets} from './uploadAssets.js'
import {ensureUniqueIds} from './util/ensureUniqueIds.js'
import {validateAssetMapForReplacementChars} from './util/validateReplacementCharacters.js'
import {validateAssetDocuments} from './validateAssetDocuments.js'
import {validateCdrDatasets} from './validateCdrDatasets.js'

const debug = createDebug('sanity:import:array')

async function importDocuments(
  documents: SanityDocument[],
  options: ImportOptions,
): Promise<ImportResult> {
  options.onProgress({step: 'Reading/validating data file'})
  documents.forEach(documentHasError)

  // Validate assetMap for replacement characters
  if (options.assetMap && options.allowReplacementCharacters !== true) {
    validateAssetMapForReplacementChars(options.assetMap)
  }

  // Validate that there are no duplicate IDs in the documents
  ensureUniqueIds(documents)

  // Ensure that any cross-dataset references has datasets to point to
  if (!options.skipCrossDatasetReferences) {
    await validateCdrDatasets(documents, options)
  }

  let filteredDocuments = documents
  // Always filter out system documents unless explicitly allowed.
  // Release system documents are an exception to this flag.
  if (options.allowSystemDocuments !== true) {
    filteredDocuments = documents.filter(
      (doc) => doc._id?.startsWith('_.releases.') || !doc._id?.startsWith('_.'),
    )
  }

  // Replace relative asset paths if one is defined
  // (file://./images/foo-bar.png -> file:///abs/olute/images/foo-bar.png)
  const absPathed = filteredDocuments.map((doc) => absolutifyPaths(doc, options.assetsBase))

  // Assign document IDs for document that do not have one. This is necessary
  // for us to strengthen references and import assets properly.
  const ided = absPathed.map((doc) => assignDocumentId(doc))

  // User might not have applied `_key` on array elements which are objects;
  // if this is the case, generate random keys to help realtime engine
  const keyed = ided.map((doc) => assignArrayKeys(doc))

  // Sanity prefers to have a `_type` on every object. Make sure references
  // has `_type` set to `reference`, and that there are no `_projectId` keys
  const docs = keyed.map((doc) => cleanupReferences(doc, options))

  // Find references that will need strengthening when import is done
  const strongRefs = docs.map(getStrongRefs).filter((ref): ref is StrongRefsTask => ref !== null)

  // Extract asset references from the documents
  const assetRefs = flatten(docs.map(getAssetRefs).filter((ref) => ref.length))

  // Remove asset references from the documents
  const assetless = docs.map(unsetAssetRefs)

  // Make strong references weak so they can be imported in any order
  const weakened = assetless.map(weakenStrongRefs)

  // Create batches of documents to import. Try to keep batches below a certain
  // byte-size (since document may vary greatly in size depending on type etc)
  const batches = batchDocuments(weakened)

  // Ensure that we don't reference missing assets, or assets in different datasets
  debug('Validating asset documents')
  await validateAssetDocuments(docs, options)

  // Trigger actual import process
  debug('Starting import of documents')
  const docsImported = await importBatches(batches, options)

  // Documents are imported, now proceed with post-import operations
  debug('Uploading assets')
  const {failures: assetWarnings} = await uploadAssets(assetRefs, options)

  // Strengthen references
  debug('Strengthening references')
  await strengthenReferences(strongRefs, options)

  // Return number of documents imported
  return {
    numDocs: docsImported,
    warnings: assetWarnings.map((warning) => ({message: `Failed to upload asset: ${warning.url}`})),
  }
}

export {importDocuments}
