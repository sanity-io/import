/* eslint-disable no-sync */
const fs = require('fs')
const path = require('path')
const {expect, test} = require('@jest/globals')
const {createClient} = require('@sanity/client')
const importer = require('../src/import')
const {getSanityClient} = require('./helpers')

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
const getFixturePath = (fix) => path.join(fixturesDir, fix)

const getNDJSONFixturePath = (fix) => getFixturePath(`${fix}.ndjson`)
const getNDJSONFixtureStream = (fix) => fs.createReadStream(getNDJSONFixturePath(fix), 'utf8')
const getNDJSONFixtureArray = (fix) =>
  fs.readFileSync(getNDJSONFixturePath(fix), 'utf8').trim().split('\n').map(JSON.parse)

test('rejects on invalid input type (null/undefined)', async () => {
  expect.assertions(1)
  await expect(importer(null, importOptions)).rejects.toHaveProperty(
    'message',
    'Stream does not seem to be a readable stream, an array or a path to a directory',
  )
})

test('rejects on invalid input type (non-array)', async () => {
  expect.assertions(1)
  await expect(importer({}, importOptions)).rejects.toHaveProperty(
    'message',
    'Stream does not seem to be a readable stream, an array or a path to a directory',
  )
})

test('rejects on invalid JSON', async () => {
  expect.assertions(1)
  await expect(
    importer(getNDJSONFixtureStream('invalid-json'), importOptions),
  ).rejects.toMatchObject({
    message: /Failed to parse line #3:.+/,
  })
})

test('rejects on invalid `_id` property', async () => {
  expect.assertions(1)
  await expect(
    importer(getNDJSONFixtureStream('invalid-id'), importOptions),
  ).rejects.toHaveProperty(
    'message',
    'Failed to parse line #2: Document contained an invalid "_id" property - must be a string',
  )
})

test('rejects on invalid `_id` property format', async () => {
  expect.assertions(1)
  await expect(
    importer(getNDJSONFixtureStream('invalid-id-format'), importOptions),
  ).rejects.toHaveProperty(
    'message',
    'Failed to parse line #2: Document ID "pk#123" is not valid: Please use alphanumeric document IDs. Dashes (-) and underscores (_) are also allowed.',
  )
})

test('rejects on missing `_type` property', async () => {
  expect.assertions(1)
  await expect(
    importer(getNDJSONFixtureStream('missing-type'), importOptions),
  ).rejects.toHaveProperty(
    'message',
    'Failed to parse line #3: Document did not contain required "_type" property of type string',
  )
})

test('rejects on missing `_type` property (from array)', async () => {
  expect.assertions(1)
  await expect(
    importer(getNDJSONFixtureArray('missing-type'), importOptions),
  ).rejects.toHaveProperty(
    'message',
    'Failed to parse document at index #2: Document did not contain required "_type" property of type string',
  )
})

test('rejects on duplicate IDs', async () => {
  expect.assertions(1)
  await expect(
    importer(getNDJSONFixtureStream('duplicate-ids'), importOptions),
  ).rejects.toHaveProperty('message', 'Found 2 duplicate IDs in the source file:\n- pk\n- espen')
})

test('rejects on missing asset type prefix', async () => {
  expect.assertions(1)
  const docs = getNDJSONFixtureArray('missing-asset-type')
  await expect(importer(docs, importOptions)).rejects.toMatchSnapshot()
})

test('accepts an array as source', async () => {
  expect.assertions(2)
  const docs = getNDJSONFixtureArray('employees')
  const client = getSanityClient(getMockMutationHandler())
  const res = await importer(docs, {client})
  expect(res).toMatchObject({numDocs: 2, warnings: []})
})

test('accepts a stream as source', async () => {
  expect.assertions(2)
  const client = getSanityClient(getMockMutationHandler())
  const res = await importer(getNDJSONFixtureStream('employees'), {client})
  expect(res).toMatchObject({numDocs: 2, warnings: []})
})

test('generates uuids for documents without id', async () => {
  expect.assertions(4)
  const match = (body) => {
    expect(body.mutations[0].create._id).toMatch(uuidMatcher)
    expect(body.mutations[1].create._id).toBe('pk')
    expect(body.mutations[2].create._id).toMatch(uuidMatcher)
  }

  const client = getSanityClient(getMockMutationHandler(match))
  const res = await importer(getNDJSONFixtureStream('valid-but-missing-ids'), {client})
  expect(res).toMatchObject({numDocs: 3, warnings: []})
})

test('references get _type, syncs _projectId by default', async () => {
  const match = (body) => {
    if (body.mutations.length !== 6) {
      return
    }

    const missingType = body.mutations.find((mut) => mut.create?._id === 'missing-type-ref')
    const cpr = body.mutations.find((mut) => mut.create?._id === 'cpr')
    expect(missingType.create.author).toHaveProperty('_type', 'reference')
    expect(cpr.create.author).toHaveProperty('_projectId', 'foo')
  }
  const client = getSanityClient(getMockMutationHandler(match))
  const res = await importer(getNDJSONFixtureStream('references'), {client})
  expect(res).toMatchObject({numDocs: 6, warnings: []})
})

test('can drop cross-dataset references', async () => {
  const match = (body) => {
    if (body.mutations.length !== 6) {
      return
    }

    // Should still do other reference operations (eg add _type)
    const missingType = body.mutations.find((mut) => mut.create?._id === 'missing-type-ref')
    const cpr = body.mutations.find((mut) => mut.create?._id === 'cpr')
    const cdr = body.mutations.find((mut) => mut.create?._id === 'cdr')
    expect(missingType.create.author).toHaveProperty('_type', 'reference')
    expect(cpr.create).not.toHaveProperty('author')
    expect(cdr.create).not.toHaveProperty('deep.author')
  }
  const client = getSanityClient(getMockMutationHandler(match))
  const res = await importer(getNDJSONFixtureStream('references'), {
    client,
    skipCrossDatasetReferences: true,
  })
  expect(res).toMatchObject({numDocs: 6, warnings: []})
})

test('allows system documents if asked', async () => {
  const client = getSanityClient(getMockMutationHandler())
  let res = await importer(getNDJSONFixtureStream('system-documents'), {
    client,
    allowSystemDocuments: true,
  })
  // Release system documents are an exception to this flag
  expect(res).toMatchObject({numDocs: 8, warnings: []})

  res = await importer(getNDJSONFixtureStream('system-documents'), {
    client,
  })
  expect(res).toMatchObject({numDocs: 5, warnings: []})
})

function getMockMutationHandler(match = 'employee creation') {
  return (req) => {
    const options = req.context.options
    const uri = options.uri || options.url

    if (uri.includes('/data/mutate')) {
      const body = JSON.parse(options.body)

      if (typeof match === 'function') {
        match(body)
      } else {
        expect(body).toMatchSnapshot(match)
      }

      const results = body.mutations.map((mut) => extractDetailsFromMutation(mut))
      return {body: {results}}
    }

    if (uri.includes('/datasets')) {
      return {body: [{name: 'foo'}, {name: 'authors'}]}
    }

    if (uri.includes('/actions')) {
      const body = JSON.parse(options.body)
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

function extractDetailsFromMutation(mut) {
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
