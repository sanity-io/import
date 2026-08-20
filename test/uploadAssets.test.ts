import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

import nock from 'nock'
import {afterEach, expect, test} from 'vitest'

import {type AssetDocument, type ImportOptions} from '../src/types.js'
import {uploadAssets} from '../src/uploadAssets.js'
import mockAssets from './fixtures/mock-assets.js'
import {getSanityClient} from './helpers/helpers.js'
import {
  type MockMutationsBody,
  type MockRequestEvent,
  type TestRequestOptions,
} from './helpers/types.js'

// Test helper to create minimal ImportOptions for uploadAssets tests
function createTestImportOptions(overrides: Partial<ImportOptions>): ImportOptions {
  return {
    allowAssetsInDifferentDataset: false,
    allowSystemDocuments: false,
    operation: 'createOrReplace',
    releasesOperation: 'ignore',
    replaceAssets: false,
    skipCrossDatasetReferences: false,
    ...overrides,
  } as ImportOptions
}

afterEach(() => {
  nock.cleanAll()
})

const noop = () => {
  /* Progress callback placeholder for testing */
}

const fixturesDir = path.join(import.meta.dirname, 'fixtures')
const imgFileUrl = pathToFileURL(path.join(fixturesDir, 'img.gif')).href
const fileAsset = {
  documentId: 'movie_1',
  path: 'metadata.poster',
  type: 'image',
  url: imgFileUrl,
}

const fetchFailClient = {
  fetch: () => Promise.reject(new Error('Some network err')),
}

test('fails if asset download fails', () => {
  expect.assertions(1)
  const asset = Object.assign({}, fileAsset, {
    url: 'http://127.0.0.1:49999/img.gif',
  })

  // @ts-expect-error - test invalid input type
  return expect(uploadAssets([asset], {client: null, onProgress: noop})).rejects.toMatchSnapshot()
})

test('fails if asset lookup fails', async () => {
  const options = {client: fetchFailClient, onProgress: noop, tag: 'my.import'}
  try {
    // @ts-expect-error - test invalid input type
    const result = await uploadAssets([fileAsset], options)
    expect(result).toBeFalsy()
  } catch (err: unknown) {
    expect((err as Error).message).toMatch(/Some network err/)
  }
})

test('will reuse an existing asset if it exists', () => {
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId-200x200.png').reply(200)

  const client = getSanityClient((event: MockRequestEvent) => {
    const options = event.context.options as TestRequestOptions
    const uri = options.uri || options.url

    if (uri?.includes('/data/query')) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId-200x200.png',
          },
        },
      }
    }

    if (uri?.includes('/data/mutate')) {
      const body = JSON.parse(options.body as string) as MockMutationsBody
      expect(body).toMatchSnapshot('single asset mutation')
      const results = body.mutations.map((mut) => ({
        id: mut.patch?.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {body: {error: `"${uri}" should not be called`}, statusCode: 400}
  })

  return expect(
    uploadAssets(
      [fileAsset],
      createTestImportOptions({
        client,
        onProgress: noop,
        tag: 'my.import',
      }),
    ),
  ).resolves.toMatchObject({
    batches: 1,
    failures: [],
  })
})

test('will upload an asset if asset doc exists but file does not', () => {
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId-200x200.png').reply(404)

  const client = getSanityClient((event: MockRequestEvent) => {
    const options = event.context.options as TestRequestOptions
    const uri = options.uri || options.url

    if (uri?.includes('/data/query')) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId-200x200.png',
          },
        },
      }
    }

    if (uri?.includes('assets/images')) {
      return {body: {document: {_id: 'image-newAssetId'}}}
    }

    if (uri?.includes('/data/mutate')) {
      const body = JSON.parse(options.body as string) as MockMutationsBody
      expect(body).toMatchSnapshot('single create mutation')
      const results = body.mutations.map((mut) => ({
        id: mut.patch?.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {body: {error: `"${uri}" should not be called`}, statusCode: 400}
  })

  return expect(
    uploadAssets(
      [fileAsset],
      createTestImportOptions({
        client,
        onProgress: noop,
        tag: 'my.import',
      }),
    ),
  ).resolves.toMatchObject({
    batches: 1,
    failures: [],
  })
})

test('will upload asset that do not already exist', () => {
  const client = getSanityClient((event: MockRequestEvent) => {
    const options = event.context.options as TestRequestOptions
    const uri = options.uri || options.url
    if (uri?.includes('/data/query')) {
      return {body: {result: null}}
    }

    if (uri?.includes('assets/images')) {
      return {body: {document: {_id: 'image-newAssetId'}}}
    }

    if (uri?.includes('/data/mutate')) {
      const body = JSON.parse(options.body as string) as MockMutationsBody
      expect(body).toMatchSnapshot('single create mutation')
      const results = body.mutations.map((mut) => ({
        id: mut.patch?.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {body: {error: `"${uri}" should not be called`}, statusCode: 400}
  })

  return expect(
    uploadAssets(
      [fileAsset],
      createTestImportOptions({
        client,
        onProgress: noop,
        tag: 'my.import',
      }),
    ),
  ).resolves.toMatchObject({
    batches: 1,
    failures: [],
  })
})

test('will upload once but batch patches', () => {
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId-200x200.png').reply(200)

  let batch = 0
  const client = getSanityClient((event: MockRequestEvent) => {
    const options = event.context.options as TestRequestOptions
    const uri = options.uri || options.url

    if (uri?.includes('/data/query')) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId-200x200.png',
          },
        },
      }
    }

    if (uri?.includes('/data/mutate')) {
      const body = JSON.parse(options.body as string) as MockMutationsBody
      expect(body).toMatchSnapshot(`batch patching (batch #${++batch})`)
      const results = body.mutations.map((mut) => ({
        id: mut.patch?.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {body: {error: `"${uri}" should not be called`}, statusCode: 400}
  })

  const upload = uploadAssets(
    mockAssets([imgFileUrl]),
    createTestImportOptions({
      client,
      onProgress: noop,
      tag: 'my.import',
    }),
  )
  return expect(upload).resolves.toMatchObject({
    batches: 60,
    failures: [],
  })
})

test('groups patches per document', () => {
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId1-200x200.gif').reply(200)
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId2-200x200.png').reply(200)

  let batch = 0
  const client = getSanityClient((event: MockRequestEvent) => {
    const options = event.context.options as TestRequestOptions
    const uri = options.uri || options.url

    if (
      uri?.includes('/data/query') &&
      uri.includes('22d5fceb6532643d0d84ffe09c40c481ecdf59e15a')
    ) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId1',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId1-200x200.gif',
          },
        },
      }
    }

    if (
      uri?.includes('/data/query') &&
      uri.includes('22a0173435d296aebd78641e24632ab8167db02cf0')
    ) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId2',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId2-200x200.png',
          },
        },
      }
    }

    if (uri?.includes('/data/mutate')) {
      const body = JSON.parse(options.body as string) as MockMutationsBody
      expect(body).toMatchSnapshot(`batch patching (batch #${++batch})`)
      const results = body.mutations.map((mut) => ({
        id: mut.patch?.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {body: {error: `"${uri}" should not be called`}, statusCode: 400}
  })

  const imgFileUrl1 = pathToFileURL(path.join(fixturesDir, 'img.gif')).href
  const imgFileUrl2 = pathToFileURL(path.join(fixturesDir, 'img1.png')).href

  const upload = uploadAssets(
    mockAssets([imgFileUrl1, imgFileUrl2]),
    createTestImportOptions({
      client,
      onProgress: noop,
      tag: 'my.import',
    }),
  )
  return expect(upload).resolves.toMatchObject({
    batches: 120,
    failures: [],
  })
})

// `uploadAssets` looks the exported metadata up by the sha1 of the bytes it downloaded, so this key
// has to be derived from the fixture — a hardcoded hash silently stops matching if img.gif changes.
const imgGifSha1 = createHash('sha1')
  .update(readFileSync(path.join(fixturesDir, 'img.gif')))
  .digest('hex')

// A second entry that is never looked up: the `asset.add-meta` patch is gated on the whole map
// holding more than one entry (`hasNonFilenameMeta`), not on the asset being imported.
const unrelatedAssetId = 'image-unrelatedAsset'

// Records the `set` payload of every patch aimed at the newly uploaded asset document — that is,
// the `asset.add-meta` patch. Patches restoring references target the referencing document instead.
function getUploadClient() {
  const addMetaPatches: Record<string, unknown>[] = []

  const client = getSanityClient((event: MockRequestEvent) => {
    const options = event.context.options as TestRequestOptions
    const uri = options.uri || options.url

    if (uri?.includes('/data/query')) {
      return {body: {result: null}}
    }

    if (uri?.includes('assets/images')) {
      return {body: {document: {_id: 'image-newAssetId'}}}
    }

    if (uri?.includes('/data/mutate')) {
      const body = JSON.parse(options.body as string) as MockMutationsBody
      for (const mut of body.mutations) {
        if (mut.patch?.id === 'image-newAssetId' && mut.patch.set) {
          addMetaPatches.push(mut.patch.set)
        }
      }
      const results = body.mutations.map((mut) => ({
        id: mut.patch?.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {body: {error: `"${uri}" should not be called`}, statusCode: 400}
  })

  return {addMetaPatches, client}
}

test('strips server-derived metadata from the asset add-meta patch', async () => {
  // The re-upload gives the asset a fresh `uploadId` derived from the newly written blob.
  // Replaying the source dataset's value would diverge the document from its blob and leave
  // the asset impossible to delete, so it must not reach the patch.
  const assetMap: Record<string, AssetDocument> = {
    [`image-${imgGifSha1}`]: {
      _createdAt: '2020-01-01T00:00:00Z',
      _id: `image-${imgGifSha1}`,
      _rev: 'sourceRev',
      _type: 'sanity.imageAsset',
      _updatedAt: '2020-01-02T00:00:00Z',
      metadata: {dimensions: {height: 200, width: 200}},
      originalFilename: 'source-name.gif',
      sha1hash: imgGifSha1,
      size: 1234,
      uploadId: 'a3813c49e4a10c652e6c8db1a63432ce9946960e',
    },
    [unrelatedAssetId]: {
      _id: unrelatedAssetId,
      _type: 'sanity.imageAsset',
      originalFilename: 'other.png',
    },
  }

  const {addMetaPatches, client} = getUploadClient()

  await uploadAssets(
    [fileAsset],
    createTestImportOptions({assetMap, client, onProgress: noop, tag: 'my.import'}),
  )

  expect(addMetaPatches).toHaveLength(1)
  const [patch] = addMetaPatches
  for (const field of [
    '_createdAt',
    '_id',
    '_rev',
    '_type',
    '_updatedAt',
    'sha1hash',
    'size',
    'uploadId',
  ]) {
    expect(patch).not.toHaveProperty(field)
  }

  // User-authored metadata is still restored
  expect(patch).toEqual({
    metadata: {dimensions: {height: 200, width: 200}},
    originalFilename: 'source-name.gif',
  })
})

test('skips the add-meta patch when only server-derived metadata is present', async () => {
  const assetMap: Record<string, AssetDocument> = {
    [`image-${imgGifSha1}`]: {
      _id: `image-${imgGifSha1}`,
      _type: 'sanity.imageAsset',
      sha1hash: imgGifSha1,
      size: 1234,
      uploadId: 'a3813c49e4a10c652e6c8db1a63432ce9946960e',
    },
    [unrelatedAssetId]: {
      _id: unrelatedAssetId,
      _type: 'sanity.imageAsset',
      originalFilename: 'other.png',
    },
  }

  const {addMetaPatches, client} = getUploadClient()

  await uploadAssets(
    [fileAsset],
    createTestImportOptions({assetMap, client, onProgress: noop, tag: 'my.import'}),
  )

  expect(addMetaPatches).toEqual([])
})
