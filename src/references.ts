import type {MultipleMutationResult, SanityClient, Transaction} from '@sanity/client'
import {extractWithPath} from '@sanity/mutator'
import debug from 'debug'
import {get} from 'lodash-es'
import pMap from 'p-map'

import {serializePath} from './serializePath.js'
import type {
  ImportOptions,
  Reference,
  SanityApiError,
  SanityDocument,
  StreamReference,
} from './types.js'
import {progressStepper} from './util/progressStepper.js'
import {retryOnFailure} from './util/retryOnFailure.js'
import {suffixTag} from './util/suffixTag.js'

const logger = debug('sanity:import')

const STRENGTHEN_CONCURRENCY = 30
const STRENGTHEN_BATCH_SIZE = 30

export interface StrongRefsTask {
  documentId: string
  references: string[]
}

interface RefPathItem {
  path: (string | number)[]
  ref: StreamReference
}

export function getStrongRefs(doc: SanityDocument): StrongRefsTask | null {
  const refs = findStrongRefs(doc).map(serializePath)
  if (refs.length) {
    return {
      documentId: doc._id,
      references: refs,
    }
  }

  return null
}

// Note: mutates in-place
export function weakenStrongRefs(doc: SanityDocument): SanityDocument {
  const refs = findStrongRefs(doc)

  refs.forEach((item) => {
    item.ref._weak = true
  })

  return doc
}

// Note: mutates in-place
export function cleanupReferences(doc: SanityDocument, options: ImportOptions): SanityDocument {
  const {targetProjectId, skipCrossDatasetReferences} = options
  extractWithPath('..[_ref]', doc)
    .map((match) => match.path.slice(0, -1))
    .map((path) => ({path, ref: get(doc, path) as StreamReference}))
    .forEach((item: RefPathItem) => {
      // We may want to skip cross-dataset references, eg when importing to other projects
      if (skipCrossDatasetReferences && '_dataset' in item.ref) {
        const leaf = item.path[item.path.length - 1]
        const parent =
          item.path.length > 1
            ? (get(doc, item.path.slice(0, -1)) as Record<string | number, unknown>)
            : doc
        if (typeof leaf === 'string' || typeof leaf === 'number') {
          delete parent[leaf]
        }
        return
      }

      // Apply missing _type on references
      if (typeof (item.ref as Reference)._type === 'undefined') {
        ;(item.ref as Reference)._type = 'reference'
      }

      // Ensure cross-dataset references point to the same project ID as being imported to
      const refWithProjectId = item.ref as StreamReference & {_projectId?: string}
      if (typeof refWithProjectId._projectId !== 'undefined') {
        refWithProjectId._projectId = targetProjectId!
      }
    })

  return doc
}

function findStrongRefs(doc: SanityDocument): RefPathItem[] {
  return extractWithPath('..[_ref]', doc)
    .map((match) => match.path.slice(0, -1))
    .map((path) => ({path, ref: get(doc, path) as StreamReference}))
    .filter((item) => item.ref._weak !== true)
}

export function strengthenReferences(
  strongRefs: StrongRefsTask[],
  options: ImportOptions,
): Promise<number[]> {
  const {client, tag} = options

  const batches: StrongRefsTask[][] = []
  for (let i = 0; i < strongRefs.length; i += STRENGTHEN_BATCH_SIZE) {
    batches.push(strongRefs.slice(i, i + STRENGTHEN_BATCH_SIZE))
  }

  if (batches.length === 0) {
    return Promise.resolve([0])
  }

  const progress = progressStepper(options.onProgress, {
    step: 'Strengthening references',
    total: batches.length,
  })

  const mapOptions = {concurrency: STRENGTHEN_CONCURRENCY}
  return pMap(batches, unsetWeakBatch.bind(null, client, progress, tag), mapOptions)
}

function unsetWeakBatch(
  client: SanityClient,
  progress: () => void,
  tag: string,
  batch: StrongRefsTask[],
): Promise<number> {
  logger('Strengthening batch of %d documents', batch.length)
  return retryOnFailure(
    () =>
      batch
        .reduce(reducePatch, client.transaction())
        .commit({visibility: 'async', tag: suffixTag(tag, 'ref.strengthen')})
        .then((res: MultipleMutationResult) => {
          progress()
          return res.results.length
        })
        .catch((err: Error) => {
          const apiError = err as SanityApiError & {step?: string}
          apiError.step = 'strengthen-references'
          throw apiError
        }),
    {isRetriable: (err: SanityApiError) => !err.statusCode || err.statusCode !== 409},
  )
}

function reducePatch(trx: Transaction, task: StrongRefsTask): Transaction {
  return trx.patch(task.documentId, (patch) =>
    patch.unset(task.references.map((path) => `${path}._weak`)),
  )
}
