const path = require('path')
const fileUrl = require('file-url')
const noop = require('lodash/noop')
const nock = require('nock')
const {expect, test} = require('@jest/globals')
const uploadAssets = require('../src/uploadAssets')
const mockAssets = require('./fixtures/mock-assets')
const {getSanityClient} = require('./helpers')

const fixturesDir = path.join(__dirname, 'fixtures')
const imgFileUrl = fileUrl(path.join(fixturesDir, 'img.gif'))
const fileAsset = {
  documentId: 'movie_1',
  path: 'metadata.poster',
  type: 'image',
  url: imgFileUrl,
}

const fetchFailClient = {
  fetch: () => Promise.reject(new Error('Some network err')),
}

test.skip('fails if asset download fails', () => {
  expect.assertions(1)
  const asset = Object.assign({}, fileAsset, {
    url: 'http://127.0.0.1:49999/img.gif',
  })

  return expect(uploadAssets([asset], {client: null, onProgress: noop})).rejects.toMatchSnapshot()
})

test('fails if asset lookup fails', async () => {
  const options = {client: fetchFailClient, onProgress: noop, tag: 'my.import'}
  try {
    const result = await uploadAssets([fileAsset], options)
    expect(result).toBeFalsy()
  } catch (err) {
    expect(err.message).toMatch(/Some network err/)
  }
})

test.skip('will reuse an existing asset if it exists', () => {
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId-200x200.png').reply(200)

  const client = getSanityClient((req) => {
    const options = req.context.options
    const uri = options.uri || options.url

    if (uri.includes('/data/query')) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId-200x200.png',
          },
        },
      }
    }

    if (uri.includes('/data/mutate')) {
      const body = JSON.parse(options.body)
      expect(body).toMatchSnapshot('single asset mutation')
      const results = body.mutations.map((mut) => ({
        id: mut.patch.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
  })

  return expect(
    uploadAssets([fileAsset], {client, onProgress: noop, tag: 'my.import'}),
  ).resolves.toMatchObject({
    batches: 1,
    failures: [],
  })
})

test.skip('will upload an asset if asset doc exists but file does not', () => {
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId-200x200.png').reply(404)

  const client = getSanityClient((req) => {
    const options = req.context.options
    const uri = options.uri || options.url

    if (uri.includes('/data/query')) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId-200x200.png',
          },
        },
      }
    }

    if (uri.includes('/assets/images')) {
      return {body: {document: {_id: 'image-newAssetId'}}}
    }

    if (uri.includes('/data/mutate')) {
      const body = JSON.parse(options.body)
      expect(body).toMatchSnapshot('single create mutation')
      const results = body.mutations.map((mut) => ({
        id: mut.patch.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
  })

  return expect(
    uploadAssets([fileAsset], {client, onProgress: noop, tag: 'my.import'}),
  ).resolves.toMatchObject({
    batches: 1,
    failures: [],
  })
})

test('will upload asset that do not already exist', () => {
  const client = getSanityClient((req) => {
    const options = req.context.options
    const uri = options.uri || options.url
    if (uri.includes('/data/query')) {
      return {body: {result: null}}
    }

    if (uri.includes('/assets/images')) {
      return {body: {document: {_id: 'image-newAssetId'}}}
    }

    if (uri.includes('/data/mutate')) {
      const body = JSON.parse(options.body)
      expect(body).toMatchSnapshot('single create mutation')
      const results = body.mutations.map((mut) => ({
        id: mut.patch.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
  })

  return expect(
    uploadAssets([fileAsset], {client, onProgress: noop, tag: 'my.import'}),
  ).resolves.toMatchObject({
    batches: 1,
    failures: [],
  })
})

test.skip('will upload once but batch patches', () => {
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId-200x200.png').reply(200)

  let batch = 0
  const client = getSanityClient((req) => {
    const options = req.context.options
    const uri = options.uri || options.url

    if (uri.includes('/data/query')) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId-200x200.png',
          },
        },
      }
    }

    if (uri.includes('/data/mutate')) {
      const body = JSON.parse(options.body)
      expect(body).toMatchSnapshot(`batch patching (batch #${++batch})`)
      const results = body.mutations.map((mut) => ({
        id: mut.patch.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
  })

  const upload = uploadAssets(mockAssets([imgFileUrl]), {
    client,
    onProgress: noop,
    tag: 'my.import',
  })
  return expect(upload).resolves.toMatchObject({
    batches: 60,
    failures: [],
  })
})

test.skip('groups patches per document', () => {
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId1-200x200.gif').reply(200)
  nock('https://foo.bar.baz').head('/images/foo/bar/someAssetId2-200x200.png').reply(200)

  let batch = 0
  const client = getSanityClient((req) => {
    const options = req.context.options
    const uri = options.uri || options.url

    if (uri.includes('/data/query') && uri.includes('22d5fceb6532643d0d84ffe09c40c481ecdf59e15a')) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId1',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId1-200x200.gif',
          },
        },
      }
    }

    if (uri.includes('/data/query') && uri.includes('22a0173435d296aebd78641e24632ab8167db02cf0')) {
      return {
        body: {
          result: {
            _id: 'image-someAssetId2',
            url: 'https://foo.bar.baz/images/foo/bar/someAssetId2-200x200.png',
          },
        },
      }
    }

    if (uri.includes('/data/mutate')) {
      const body = JSON.parse(options.body)
      expect(body).toMatchSnapshot(`batch patching (batch #${++batch})`)
      const results = body.mutations.map((mut) => ({
        id: mut.patch.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
  })

  const imgFileUrl1 = fileUrl(path.join(fixturesDir, 'img.gif'))
  const imgFileUrl2 = fileUrl(path.join(fixturesDir, 'img1.png'))

  const upload = uploadAssets(mockAssets([imgFileUrl1, imgFileUrl2]), {
    client,
    onProgress: noop,
    tag: 'my.import',
  })
  return expect(upload).resolves.toMatchObject({
    batches: 120,
    failures: [],
  })
})
