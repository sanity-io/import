 
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

import {createClient} from '@sanity/client'
import {expect, test} from 'vitest'

import {sanityImport} from '../src/import.js'
import type {SanityDocument} from '../src/types.js'
import {getSanityClient} from './helpers/helpers.js'
import type {
  InjectFunction,
  MockMutationsBody,
  MockRequestEvent,
  TestMutation,
  TestRequestOptions,
} from './helpers/types.js'

const defaultClient = createClient({
  apiVersion: '2025-02-19',
  projectId: 'foo',
  dataset: 'bar',
  useCdn: false,
  token: 'foo',
})

const uuidMatcher = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/
const importOptions = {client: defaultClient}
const fixturesDir = path.join(__dirname, 'fixtures')
const getFixturePath = (fix: string) => path.join(fixturesDir, fix)

const getExportFixtureStream = (fix: string) => fs.createReadStream(getFixturePath(`${fix}.tar.gz`))
const getNDJSONFixturePath = (fix: string) => getFixturePath(`${fix}.ndjson`)
const getNDJSONFixtureStream = (fix: string) =>
  fs.createReadStream(getNDJSONFixturePath(fix), 'utf8')
const getNDJSONFixtureArray = (fix: string): SanityDocument[] =>
  fs
    .readFileSync(getNDJSONFixturePath(fix), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as SanityDocument)

test('rejects on invalid input type (null/undefined)', () => {
  expect.assertions(1)
  // @ts-expect-error - test invalid input type
  expect(() => sanityImport(null, importOptions)).toThrow(
    'Input does not seem to be a readable stream, an array or a path to a directory',
  )
})

test('rejects on invalid input type (non-array)', () => {
  expect.assertions(1)
  // @ts-expect-error - test invalid input type
  expect(() => sanityImport({}, importOptions)).toThrow(
    'Input does not seem to be a readable stream, an array or a path to a directory',
  )
})

test('rejects on invalid JSON', async () => {
  expect.assertions(1)
  await expect(
    sanityImport(getNDJSONFixtureStream('invalid-json'), importOptions),
  ).rejects.toMatchObject({
    message: /Failed to parse line #3:.+/,
  })
})

test('rejects on invalid `_id` property', async () => {
  expect.assertions(1)
  await expect(
    sanityImport(getNDJSONFixtureStream('invalid-id'), importOptions),
  ).rejects.toHaveProperty(
    'message',
    'Failed to parse line #2: Document contained an invalid "_id" property - must be a string',
  )
})

test('rejects on invalid `_id` property format', async () => {
  expect.assertions(1)
  await expect(
    sanityImport(getNDJSONFixtureStream('invalid-id-format'), importOptions),
  ).rejects.toHaveProperty(
    'message',
    'Failed to parse line #2: Document ID "pk#123" is not valid: Please use alphanumeric document IDs. Dashes (-) and underscores (_) are also allowed.',
  )
})

test('rejects on missing `_type` property', async () => {
  expect.assertions(1)
  await expect(
    sanityImport(getNDJSONFixtureStream('missing-type'), importOptions),
  ).rejects.toHaveProperty(
    'message',
    'Failed to parse line #3: Document did not contain required "_type" property of type string',
  )
})

test('rejects on missing `_type` property (from array)', async () => {
  expect.assertions(1)
  await expect(
    sanityImport(getNDJSONFixtureArray('missing-type'), importOptions),
  ).rejects.toHaveProperty(
    'message',
    'Failed to parse document at index #2: Document did not contain required "_type" property of type string',
  )
})

test('rejects on duplicate IDs', async () => {
  expect.assertions(1)
  await expect(
    sanityImport(getNDJSONFixtureStream('duplicate-ids'), importOptions),
  ).rejects.toHaveProperty('message', 'Found 2 duplicate IDs in the source file:\n- pk\n- espen')
})

test('rejects on missing asset type prefix', async () => {
  expect.assertions(1)
  const docs = getNDJSONFixtureArray('missing-asset-type')
  await expect(sanityImport(docs, importOptions)).rejects.toMatchSnapshot()
})

test('accepts an array as source', async () => {
  expect.assertions(2)
  const docs = getNDJSONFixtureArray('employees')
  const client = getSanityClient(getMockMutationHandler())
  const res = await sanityImport(docs, {client})
  expect(res).toMatchObject({numDocs: 2, warnings: []})
})

test('accepts a stream as source', async () => {
  expect.assertions(2)
  const client = getSanityClient(getMockMutationHandler())
  const res = await sanityImport(getNDJSONFixtureStream('employees'), {client})
  expect(res).toMatchObject({numDocs: 2, warnings: []})
})

test('accepts a tar.gz stream as source', async () => {
  expect.assertions(2)
  const client = getSanityClient(getMockMutationHandler())
  const res = await sanityImport(getExportFixtureStream('export'), {client})
  expect(res).toMatchObject({numDocs: 2, warnings: []})
})

test('generates uuids for documents without id', async () => {
  expect.assertions(4)
  const match = (body: MockMutationsBody) => {
    expect(body.mutations[0]?.create?._id).toMatch(uuidMatcher)
    expect(body.mutations[1]?.create?._id).toBe('pk')
    expect(body.mutations[2]?.create?._id).toMatch(uuidMatcher)
  }

  const client = getSanityClient(getMockMutationHandler(match))
  const res = await sanityImport(getNDJSONFixtureStream('valid-but-missing-ids'), {client})
  expect(res).toMatchObject({numDocs: 3, warnings: []})
})

test('references get _type, syncs _projectId by default', async () => {
  const match = (body: MockMutationsBody) => {
    if (body.mutations.length !== 6) {
      return
    }

    const missingType = body.mutations.find((mut) => mut.create?._id === 'missing-type-ref')
    const cpr = body.mutations.find((mut) => mut.create?._id === 'cpr')
    expect(missingType?.create?.author).toHaveProperty('_type', 'reference')
    expect(cpr?.create?.author).toHaveProperty('_projectId', 'foo')
  }
  const client = getSanityClient(getMockMutationHandler(match))
  const res = await sanityImport(getNDJSONFixtureStream('references'), {client})
  expect(res).toMatchObject({numDocs: 6, warnings: []})
})

test('can drop cross-dataset references', async () => {
  const match = (body: MockMutationsBody) => {
    if (body.mutations.length !== 6) {
      return
    }

    // Should still do other reference operations (eg add _type)
    const missingType = body.mutations.find((mut) => mut.create?._id === 'missing-type-ref')
    const cpr = body.mutations.find((mut) => mut.create?._id === 'cpr')
    const cdr = body.mutations.find((mut) => mut.create?._id === 'cdr')
    expect(missingType?.create?.author).toHaveProperty('_type', 'reference')
    expect(cpr?.create).not.toHaveProperty('author')
    expect(cdr?.create).not.toHaveProperty('deep.author')
  }
  const client = getSanityClient(getMockMutationHandler(match))
  const res = await sanityImport(getNDJSONFixtureStream('references'), {
    client,
    skipCrossDatasetReferences: true,
  })
  expect(res).toMatchObject({numDocs: 6, warnings: []})
})

test('allows system documents if asked', async () => {
  const client = getSanityClient(getMockMutationHandler())
  let res = await sanityImport(getNDJSONFixtureStream('system-documents'), {
    client,
    allowSystemDocuments: true,
  })
  // Release system documents are an exception to this flag
  expect(res).toMatchObject({numDocs: 8, warnings: []})

  res = await sanityImport(getNDJSONFixtureStream('system-documents'), {
    client,
  })
  expect(res).toMatchObject({numDocs: 5, warnings: []})
})

test('rejects on Unicode replacement character in stream', async () => {
  expect.assertions(1)
  await expect(
    sanityImport(getNDJSONFixtureStream('replacement-char'), importOptions),
  ).rejects.toHaveProperty(
    'message',
    'Unicode replacement character (U+FFFD) found on line 2. This usually indicates encoding issues in the source data.',
  )
})

test('allows replacement character when allowReplacementCharacters is true', async () => {
  expect.assertions(2)
  const client = getSanityClient(getMockMutationHandler())
  const res = await sanityImport(getNDJSONFixtureStream('replacement-char'), {
    client,
    allowReplacementCharacters: true,
  })
  expect(res).toMatchObject({numDocs: 3, warnings: []})
})

test('rejects on Unicode replacement character in assetMap', async () => {
  expect.assertions(1)
  const docs = getNDJSONFixtureArray('employees')
  const assetMap = {
    'https://example.com/image.png': {
      _id: 'image-abc',
      _type: 'sanity.imageAsset' as const,
      url: 'https://example.com/image.png',
      originalFilename: 'bad\uFFFDname.png',
    },
  }
  await expect(sanityImport(docs, {...importOptions, assetMap})).rejects.toHaveProperty(
    'message',
    'Unicode replacement character (U+FFFD) found at assetMap["https://example.com/image.png"].originalFilename. This usually indicates encoding issues in the source data.',
  )
})

test('allows replacement character in assetMap when allowReplacementCharacters is true', async () => {
  expect.assertions(2)
  const docs = getNDJSONFixtureArray('employees')
  const client = getSanityClient(getMockMutationHandler())
  const assetMap = {
    'https://example.com/image.png': {
      _id: 'image-abc',
      _type: 'sanity.imageAsset' as const,
      url: 'https://example.com/image.png',
      originalFilename: 'bad\uFFFDname.png',
    },
  }
  const res = await sanityImport(docs, {client, assetMap, allowReplacementCharacters: true})
  expect(res).toMatchObject({numDocs: 2, warnings: []})
})

test('skips asset uploads for already-existing documents in createIfNotExists mode', async () => {
  // movie_1 and movie_3 already exist (API returns operation: 'none')
  // movie_2 is new (API returns operation: 'create')
  // Only movie_2's asset should be uploaded/patched
  const existingIds = new Set(['movie_1', 'movie_3'])
  const patchedDocumentIds: string[] = []

  const imgUrl = pathToFileURL(path.join(fixturesDir, 'img.gif')).href

  const client = getSanityClient((event: MockRequestEvent) => {
    const options = event.context.options as TestRequestOptions
    const uri = options.uri || options.url

    if (uri?.includes('/data/mutate')) {
      const body = JSON.parse(options.body as string) as MockMutationsBody

      // Check if this is a document import batch (createIfNotExists) or asset ref patch
      const hasCreateIfNotExists = body.mutations.some((mut) => mut.createIfNotExists)
      if (hasCreateIfNotExists) {
        // Simulate API: return 'none' for existing docs, 'create' for new ones
        const results = body.mutations.map((mut) => {
          const id = mut.createIfNotExists!._id
          return {
            id,
            operation: existingIds.has(id) ? 'none' : 'create',
          }
        })
        return {body: {results}}
      }

      // This is an asset reference patch — track which documents get patched
      for (const mut of body.mutations) {
        if (mut.patch) {
          patchedDocumentIds.push(mut.patch.id)
        }
      }
      const results = body.mutations.map((mut) => ({
        id: mut.patch?.id,
        operation: 'update',
      }))
      return {body: {results}}
    }

    // Asset lookup — pretend no existing assets so upload is attempted
    if (uri?.includes('/data/query')) {
      return {body: {result: null}}
    }

    // Asset upload
    if (uri?.includes('assets/images')) {
      return {body: {document: {_id: 'image-newAssetId'}}}
    }

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
  })

  const docs: SanityDocument[] = [
    {_id: 'movie_1', _type: 'movie', title: 'Alien', poster: {_sanityAsset: `image@${imgUrl}`}},
    {
      _id: 'movie_2',
      _type: 'movie',
      title: 'Blade Runner',
      poster: {_sanityAsset: `image@${imgUrl}`},
    },
    {_id: 'movie_3', _type: 'movie', title: 'Arrival', poster: {_sanityAsset: `image@${imgUrl}`}},
  ]
  const res = await sanityImport(docs, {client, operation: 'createIfNotExists'})

  // All 3 docs counted as processed
  expect(res.numDocs).toBe(3)

  // Only movie_2 (the newly created doc) should have its asset reference patched
  expect(patchedDocumentIds).toEqual(['movie_2'])
})

function getMockMutationHandler(
  match: string | ((body: MockMutationsBody) => void) = 'employee creation',
): InjectFunction {
  return (event: MockRequestEvent) => {
    const options = event.context.options as TestRequestOptions
    const uri = options.uri || options.url

    if (uri?.includes('/data/mutate')) {
      const body = JSON.parse(options.body as string) as MockMutationsBody

      if (typeof match === 'function') {
        match(body)
      } else {
        expect(body).toMatchSnapshot(match)
      }

      const results = body.mutations.map((mut) => extractDetailsFromMutation(mut))
      return {body: {results}}
    }

    if (uri?.includes('/datasets')) {
      return {body: [{name: 'foo'}, {name: 'authors'}]}
    }

    if (uri?.includes('/actions')) {
      const body = JSON.parse(options.body as string) as MockMutationsBody
      if (typeof match === 'function') {
        match(body)
      } else {
        expect(body).toMatchSnapshot(match)
      }

      return {body: [{TransactionID: 'foo'}]}
    }

    return {statusCode: 400, body: {error: `"${uri}" should not be called`}}
  }
}

function extractDetailsFromMutation(mut: TestMutation) {
  if (mut.patch) {
    return {operation: 'update', id: mut.patch.id}
  }
  if (mut.create) {
    return {operation: 'create', id: mut.create._id}
  }
  if (mut.createIfNotExists) {
    return {operation: 'create', id: mut.createIfNotExists._id}
  }
  if (mut.createOrReplace) {
    return {operation: 'create', id: mut.createOrReplace._id}
  }
  if (mut.delete) {
    return {operation: 'delete', id: mut.delete.id}
  }
  throw new Error('Unknown mutation type')
}
