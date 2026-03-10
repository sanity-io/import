import {pathToFileURL} from 'node:url'

import {extractWithPath} from '@sanity/mutator'
import get from 'lodash-es/get.js'
import set from 'lodash-es/set.js'
import unset from 'lodash-es/unset.js'

import {serializePath} from './serializePath.js'
import {type SanityDocument} from './types.js'

const assetKey = '_sanityAsset'
const assetMatcher = /^(file|image)@([a-z]+:\/\/.*)/

interface AssetRef {
  documentId: string
  path: string
  type: string
  url: string
}

// Note: mutates in-place
export function unsetAssetRefs(doc: SanityDocument): SanityDocument {
  for (const path of findAssetRefs(doc)) {
    const parentPath = path.slice(0, -1)
    const parent = get(doc, parentPath) as Record<string, unknown>

    // If the only key in the object is `_sanityAsset`, unset the whole thing,
    // as we will be using a `setIfMissing({[path]: {}})` patch to enforce it.
    // Prevents empty objects from appearing while import is running
    const isOnlyKey = parent && Object.keys(parent).length === 1 && parent[assetKey]
    const unsetPath = isOnlyKey ? parentPath : path

    unset(doc, unsetPath)
  }

  return doc
}

// Note: mutates in-place
export function absolutifyPaths(doc: SanityDocument, absPath?: string): SanityDocument {
  if (!absPath) {
    return doc
  }

  const modifier = (value: string): string =>
    value
      .replace(/file:\/\/\.\//i, `${pathToFileURL(absPath).href}/`)
      .replace(/(https?):\/\/\.\//, `$1://${absPath}/`)

  for (const path of findAssetRefs(doc)) {
    const value = get(doc, path) as string
    set(doc, path, modifier(value))
  }

  return doc
}

export function getAssetRefs(doc: SanityDocument): AssetRef[] {
  return findAssetRefs(doc)
    .map((path) => validateAssetImportKey(path, doc))
    .map((path) => {
      const value = get(doc, path) as string
      return {
        documentId: doc._id,
        path: serializePath({path: path.filter((segment) => isNotAssetKey(segment))}),
        type: value.replace(assetMatcher, '$1'),
        url: value.replace(assetMatcher, '$2'),
      }
    })
}

function isNotAssetKey(segment: number | string): boolean {
  return segment !== assetKey
}

function findAssetRefs(doc: SanityDocument): (number | string)[][] {
  return extractWithPath(`..[${assetKey}]`, doc).map((match) => match.path)
}

function validateAssetImportKey(
  path: (number | string)[],
  doc: SanityDocument,
): (number | string)[] {
  if (!assetMatcher.test(get(doc, path) as string)) {
    throw new Error(
      [
        'Asset type is not specified.',
        '`_sanityAsset` values must be prefixed with a type, eg image@url or file@url.',
        `See document with ID "${doc._id}", path: ${serializePath({path})}`,
      ].join('\n'),
    )
  }

  return path
}
