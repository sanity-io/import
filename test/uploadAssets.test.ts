import nock from 'nock'
import path from 'path'
import {pathToFileURL} from 'url'
import {afterEach, expect, test} from 'vitest'

import type {ImportOptions} from '../src/types.js'
import {uploadAssets} from '../src/uploadAssets.js'

// Test helper to create minimal ImportOptions for uploadAssets tests
function createTestImportOptions(overrides: Partial<ImportOptions>): ImportOptions {
  return {
    operation: 'createOrReplace',
    allowAssetsInDifferentDataset: false,
    replaceAssets: false,
    skipCrossDatasetReferences: false,
    allowSystemDocuments: false,
    releasesOperation: 'ignore',
    ...overrides,
  } as ImportOptions
}
import mockAssets from './fixtures/mock-assets.js'
import {getSanityClient} from './helpers/helpers.js'
import type {MockMutationsBody, MockRequestEvent, TestRequestOptions} from './helpers/types.js'

afterEach(() => {
  nock.cleanAll()
})

const noop = () => {
  /* Progress callback placeholder for testing */
}

const fixturesDir = path.join(__dirname, 'fixtures')
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

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
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

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
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

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
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

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
  })

  const upload = uploadAssets(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    mockAssets([imgFileUrl]) as any,
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

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
  })

  const imgFileUrl1 = pathToFileURL(path.join(fixturesDir, 'img.gif')).href
  const imgFileUrl2 = pathToFileURL(path.join(fixturesDir, 'img1.png')).href

  const upload = uploadAssets(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    mockAssets([imgFileUrl1, imgFileUrl2]) as any,
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
