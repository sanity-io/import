import {pathToFileURL} from 'node:url'

import {extractWithPath} from '@sanity/mutator'
import {get, set, unset} from 'lodash-es'

import {serializePath} from './serializePath.js'
import type {SanityDocument} from './types.js'

const assetKey = '_sanityAsset'
const assetMatcher = /^(file|image)@([a-z]+:\/\/.*)/

export interface AssetRef {
  documentId: string
  path: string
  url: string
  type: string
}

// Note: mutates in-place
export function unsetAssetRefs(doc: SanityDocument): SanityDocument {
  findAssetRefs(doc).forEach((path) => {
    const parentPath = path.slice(0, -1)
    const parent = get(doc, parentPath) as Record<string, unknown>

    // If the only key in the object is `_sanityAsset`, unset the whole thing,
    // as we will be using a `setIfMissing({[path]: {}})` patch to enforce it.
    // Prevents empty objects from appearing while import is running
    const isOnlyKey = parent && Object.keys(parent).length === 1 && parent[assetKey]
    const unsetPath = isOnlyKey ? parentPath : path

    unset(doc, unsetPath)
  })

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

  findAssetRefs(doc).forEach((path) => {
    const value = get(doc, path) as string
    set(doc, path, modifier(value))
  })

  return doc
}

export function getAssetRefs(doc: SanityDocument): AssetRef[] {
  return findAssetRefs(doc)
    .map((path) => validateAssetImportKey(path, doc))
    .map((path) => {
      const value = get(doc, path) as string
      return {
        documentId: doc._id,
        path: serializePath({path: path.filter(isNotAssetKey)}),
        url: value.replace(assetMatcher, '$2'),
        type: value.replace(assetMatcher, '$1'),
      }
    })
}

function isNotAssetKey(segment: string | number): boolean {
  return segment !== assetKey
}

function findAssetRefs(doc: SanityDocument): (string | number)[][] {
  return extractWithPath(`..[${assetKey}]`, doc).map((match) => match.path)
}

export function validateAssetImportKey(
  path: (string | number)[],
  doc: SanityDocument,
): (string | number)[] {
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
