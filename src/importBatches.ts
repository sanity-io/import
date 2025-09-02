import type {MultipleMutationResult, Transaction} from '@sanity/client'
import {partition} from 'lodash-es'
import pMap from 'p-map'

import type {ImportOptions, SanityDocument} from './types.js'
import {progressStepper} from './util/progressStepper.js'
import {retryOnFailure} from './util/retryOnFailure.js'
import {suffixTag} from './util/suffixTag.js'

const DOCUMENT_IMPORT_CONCURRENCY = 6

export async function importBatches(
  batches: SanityDocument[][],
  options: ImportOptions,
): Promise<number> {
  const progress = progressStepper(options.onProgress, {
    step: 'Importing documents',
    total: batches.length,
  })

  const mapOptions = {concurrency: DOCUMENT_IMPORT_CONCURRENCY}
  const batchSizes = await pMap(batches, importBatch.bind(null, options, progress), mapOptions)

  return batchSizes.reduce((prev, add) => prev + add, 0)
}

function importBatch(
  options: ImportOptions,
  progress: () => void,
  batch: SanityDocument[],
): Promise<number> {
  const {client, operation, releasesOperation, tag} = options
  const maxRetries = operation === 'create' ? 1 : 3

  return retryOnFailure(
    () => {
      const [releaseDocs, docs] = partition(batch, (doc) => doc._id.startsWith('_.releases.'))

      const docsTransaction =
        docs.length > 0
          ? docs
              .reduce((trx: Transaction, doc) => (trx as any)[operation](doc), client.transaction())
              .commit({visibility: 'async', tag: suffixTag(tag, 'doc.create')})
              .then((res: MultipleMutationResult) => {
                progress()
                return res.results.length
              })
          : Promise.resolve(0)

      const releasesAction = releaseDocs.map((doc: any) =>
        (client as any)
          .action({
            actionType: 'sanity.action.release.import',
            releaseId: doc.name,
            attributes: doc,
            ifExists: releasesOperation,
          })
          .then(() => 1)
          .catch((err: any) => {
            err.message = `Release import failed for ${doc._id}: ${err.message}`

            throw err
          }),
      )

      return Promise.all([docsTransaction, ...releasesAction]).then((results) => {
        const totalCount = results.reduce((sum: number, count: number) => sum + count, 0)
        return totalCount
      })
    },
    {maxTries: maxRetries, isRetriable},
  )
}

function isRetriable(err: any): boolean {
  return !err.response || err.response.statusCode !== 409
}
