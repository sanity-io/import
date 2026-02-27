import type {ImportReleaseAction, MultipleMutationResult, Transaction} from '@sanity/client'
import {partition} from 'lodash-es'
import pMap from 'p-map'

import type {ImportOptions, SanityApiError, SanityDocument} from './types.js'
import {progressStepper} from './util/progressStepper.js'
import {retryOnFailure} from './util/retryOnFailure.js'
import {suffixTag} from './util/suffixTag.js'

const DOCUMENT_IMPORT_CONCURRENCY = 6

export interface BatchImportResult {
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
  const batchResults = await pMap(
    batches,
    importBatch.bind(null, options, progress),
    mapOptions,
  )

  return batchResults.reduce<BatchImportResult>(
    (acc, result) => ({
      count: acc.count + result.count,
      importedIds: acc.importedIds.concat(result.importedIds),
    }),
    {count: 0, importedIds: []},
  )
}

function importBatch(
  options: ImportOptions,
  progress: () => void,
  batch: SanityDocument[],
): Promise<BatchImportResult> {
  const {client, operation, releasesOperation, tag} = options
  const maxRetries = operation === 'create' ? 1 : 3

  return retryOnFailure(
    () => {
      const [releaseDocs, docs] = partition(batch, (doc) => doc._id.startsWith('_.releases.'))

      const docsTransaction =
        docs.length > 0
          ? docs
              .reduce((trx: Transaction, doc) => {
                if (operation === 'create') return trx.create(doc)
                if (operation === 'createIfNotExists') return trx.createIfNotExists(doc)
                if (operation === 'createOrReplace') return trx.createOrReplace(doc)
                throw new Error(`Unknown operation: ${operation as string}`)
              }, client.transaction())
              .commit({visibility: 'async', tag: suffixTag(tag, 'doc.create')})
              .then((res: MultipleMutationResult) => {
                progress()
                const importedIds = res.results
                  .filter((r) => r.operation !== 'none')
                  .map((r) => r.id)
                return {count: res.results.length, importedIds}
              })
          : Promise.resolve({count: 0, importedIds: [] as string[]})

      const releasesAction = releaseDocs.map((doc: SanityDocument) => {
        const actionParams: ImportReleaseAction = {
          actionType: 'sanity.action.release.import',
          releaseId: doc.name as string,
          attributes: doc,
          ifExists: releasesOperation,
        }
        return client
          .action(actionParams)
          .then(() => ({count: 1, importedIds: [doc._id]}))
          .catch((err: Error) => {
            err.message = `Release import failed for ${doc._id}: ${err.message}`
            throw err
          })
      })

      return Promise.all([docsTransaction, ...releasesAction]).then((results) =>
        results.reduce<BatchImportResult>(
          (acc, result) => ({
            count: acc.count + result.count,
            importedIds: acc.importedIds.concat(result.importedIds),
          }),
          {count: 0, importedIds: []},
        ),
      )
    },
    {maxTries: maxRetries, isRetriable},
  )
}

function isRetriable(err: SanityApiError): boolean {
  return !err.response || err.response.statusCode !== 409
}
