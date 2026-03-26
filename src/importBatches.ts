import {type ImportReleaseAction, type MultipleMutationResult} from '@sanity/client'
import pMap from 'p-map'

import {type ImportOptions, type SanityApiError, type SanityDocument} from './types.js'
import {progressStepper} from './util/progressStepper.js'
import {retryOnFailure} from './util/retryOnFailure.js'
import {suffixTag} from './util/suffixTag.js'

const DOCUMENT_IMPORT_CONCURRENCY = 6
const RELEASE_IMPORT_CONCURRENCY = 3

interface BatchImportResult {
  count: number
  importedIds: string[]
}

export async function importBatches(
  batches: SanityDocument[][],
  options: ImportOptions,
): Promise<BatchImportResult> {
  const progress = progressStepper(options.onProgress, {
    step: 'Importing documents',
    total: batches.length,
  })

  const mapOptions = {concurrency: DOCUMENT_IMPORT_CONCURRENCY}
  const batchResults = await pMap(batches, importBatch.bind(null, options, progress), mapOptions)

  const result: BatchImportResult = {count: 0, importedIds: []}
  for (const batchResult of batchResults) {
    result.count += batchResult.count
    result.importedIds = [...result.importedIds, ...batchResult.importedIds]
  }
  return result
}

function importBatch(
  options: ImportOptions,
  progress: () => void,
  batch: SanityDocument[],
): Promise<BatchImportResult> {
  const {client, operation, releasesOperation, tag} = options
  const maxRetries = operation === 'create' ? 1 : 3

  return retryOnFailure(
    async () => {
      const releaseDocs: SanityDocument[] = []
      const docs: SanityDocument[] = []
      for (const doc of batch) {
        if (doc._id.startsWith('_.releases.')) {
          releaseDocs.push(doc)
        } else {
          docs.push(doc)
        }
      }

      const docsTransaction =
        docs.length > 0
          ? (() => {
              let trx = client.transaction()
              for (const doc of docs) {
                switch (operation) {
                  case 'create': {
                    trx = trx.create(doc)
                    break
                  }
                  case 'createIfNotExists': {
                    trx = trx.createIfNotExists(doc)
                    break
                  }
                  case 'createOrReplace': {
                    trx = trx.createOrReplace(doc)
                    break
                  }
                  default: {
                    throw new Error(`Unknown operation: ${operation as string}`)
                  }
                }
              }
              return trx
            })()
              .commit({tag: suffixTag(tag, 'doc.create'), visibility: 'async'})
              .then((res: MultipleMutationResult) => {
                progress()
                const importedIds = res.results
                  .filter((r) => r.operation !== 'none')
                  .map((r) => r.id)
                return {count: res.results.length, importedIds}
              })
          : Promise.resolve({count: 0, importedIds: [] as string[]})

      const releaseResults =
        releaseDocs.length > 0
          ? await pMap(
              releaseDocs,
              (doc: SanityDocument) => {
                const actionParams: ImportReleaseAction = {
                  actionType: 'sanity.action.release.import',
                  attributes: doc,
                  ifExists: releasesOperation,
                  releaseId: doc.name as string,
                }
                return client
                  .action(actionParams)
                  .then((): BatchImportResult => ({count: 1, importedIds: [doc._id]}))
                  .catch((err: SanityApiError) => {
                    err.message = `Release import failed for ${doc._id}: ${err.message}`
                    throw err
                  })
              },
              {concurrency: RELEASE_IMPORT_CONCURRENCY, stopOnError: false},
            ).catch((err: AggregateError | SanityApiError) => {
              if (err instanceof AggregateError) {
                const permissionError = err.errors.find(
                  (e: SanityApiError) =>
                    e.response?.statusCode === 403 || e.statusCode === 403,
                )
                throw permissionError || err.errors[0]
              }
              throw err
            })
          : []

      const docsResult = await docsTransaction
      const combined: BatchImportResult = {count: 0, importedIds: []}
      for (const r of [docsResult, ...releaseResults]) {
        combined.count += r.count
        combined.importedIds = [...combined.importedIds, ...r.importedIds]
      }
      return combined
    },
    {isRetriable, maxTries: maxRetries},
  )
}

function isRetriable(err: SanityApiError): boolean {
  const statusCode = err.response?.statusCode ?? err.statusCode
  // 409 Conflict and 403 Forbidden are not retriable
  if (statusCode === 409 || statusCode === 403) {
    return false
  }
  return true
}
