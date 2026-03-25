import {extractWithPath} from '@sanity/mutator'

import {type CrossDatasetReference, type ImportOptions, type SanityDocument} from './types.js'
import {deepGet} from './util/deepGet.js'

export async function validateCdrDatasets(
  docs: SanityDocument[],
  options: ImportOptions,
): Promise<void> {
  const datasets = getDatasetsFromCrossDatasetReferences(docs)
  if (datasets.length === 0) {
    return
  }

  const {client} = options
  const existing = new Set((await client.datasets.list()).map((dataset) => dataset.name))
  const missing = datasets.filter((dataset) => !existing.has(dataset))

  if (missing.length > 1) {
    throw new Error(
      [
        `The data to be imported contains one or more cross-dataset references, which refers to datasets that do not exist in the target project.`,
        `Missing datasets: ${missing.map((ds) => `"${ds}"`).join(', ')}`,
        'Either create these datasets in the given project, or use the `--skip-cross-dataset-references` flag to skip these references.',
      ].join('\n'),
    )
  }

  if (missing.length === 1) {
    throw new Error(
      [
        `The data to be imported contains one or more cross-dataset references, which refers to a dataset that do not exist in the target project.`,
        `Missing dataset: "${missing[0]}"`,
        'Either create this dataset in the given project, or use the `--skip-cross-dataset-references` flag to skip these references.',
      ].join('\n'),
    )
  }
}

function getDatasetsFromCrossDatasetReferences(docs: SanityDocument[]): string[] {
  const datasets = new Set<string>()
  for (const doc of docs) {
    findCrossCdr(doc, datasets)
  }

  return [...datasets]
}

function findCrossCdr(doc: SanityDocument, set: Set<string>): Set<string> {
  const refs = extractWithPath('..[_ref]', doc)
    .map((match) => deepGet(doc, match.path.slice(0, -1)) as CrossDatasetReference | undefined)
    .filter((ref): ref is CrossDatasetReference => typeof ref?._dataset === 'string')

  for (const ref of refs) {
    set.add(ref._dataset)
  }

  return set
}
