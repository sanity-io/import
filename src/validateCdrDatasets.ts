import {extractWithPath} from '@sanity/mutator'
import {get} from 'lodash-es'

import type {CrossDatasetReference, ImportOptions, SanityDocument} from './types.js'

export async function validateCdrDatasets(
  docs: SanityDocument[],
  options: ImportOptions,
): Promise<void> {
  const datasets = getDatasetsFromCrossDatasetReferences(docs)
  if (datasets.length === 0) {
    return
  }

  const {client} = options
  const existing = (await client.datasets.list()).map((dataset) => dataset.name)
  const missing = datasets.filter((dataset) => !existing.includes(dataset))

  if (missing.length > 1) {
    throw new Error(
      [
        `The data to be imported contains one or more cross-dataset references, which refers to datasets that do not exist in the target project.`,
        `Missing datasets: ${missing.map((ds) => `"${ds}"`).join(', ')}`,
        'Either create these datasets in the given project, or use the `skipCrossDatasetReferences` option to skip these references.',
      ].join('\n'),
    )
  }

  if (missing.length === 1) {
    throw new Error(
      [
        `The data to be imported contains one or more cross-dataset references, which refers to a dataset that do not exist in the target project.`,
        `Missing dataset: "${missing[0]}"`,
        'Either create this dataset in the given project, or use the `skipCrossDatasetReferences` option to skip these references.',
      ].join('\n'),
    )
  }
}

function getDatasetsFromCrossDatasetReferences(docs: SanityDocument[]): string[] {
  const datasets = new Set<string>()
  for (const doc of docs) {
    findCrossCdr(doc, datasets)
  }

  return Array.from(datasets)
}

function findCrossCdr(doc: SanityDocument, set: Set<string>): Set<string> {
  return extractWithPath('..[_ref]', doc)
    .map((match) => get(doc, match.path.slice(0, -1)) as CrossDatasetReference | undefined)
    .filter((ref): ref is CrossDatasetReference => typeof ref?._dataset === 'string')
    .reduce((datasets, ref) => datasets.add(ref._dataset), set)
}
