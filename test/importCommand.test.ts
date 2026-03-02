import {testCommand} from '@sanity/cli-test'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {DatasetImportCommand} from '../src/commands/dataset/import.js'
import {ReplacementCharError} from '../src/util/validateReplacementCharacters.js'

const mocks = vi.hoisted(() => ({
  getProjectCliClient: vi.fn(),
  sanityImport: vi.fn(),
}))

vi.mock('../src/import.js', () => ({
  sanityImport: mocks.sanityImport,
}))

vi.mock('@sanity/cli-core', async () => {
  const actual = await vi.importActual<typeof import('@sanity/cli-core')>('@sanity/cli-core')
  return {
    ...actual,
    getProjectCliClient: mocks.getProjectCliClient,
  }
})

const defaultMocks = {
  cliConfig: {api: {dataset: 'production', projectId: 'test-project'}},
  projectRoot: {
    directory: '/test/path',
    path: '/test/path/sanity.config.ts',
    type: 'studio' as const,
  },
  token: 'test-token',
}

const defaultArgs = [
  'test/fixtures/employees.ndjson',
  '-p',
  'test-project',
  '-d',
  'test-dataset',
  '-t',
  'test-token',
]

describe('DatasetImportCommand', () => {
  beforeEach(() => {
    mocks.getProjectCliClient.mockResolvedValue({})
    mocks.sanityImport.mockResolvedValue({numDocs: 0, warnings: []})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('errors when no token is provided', async () => {
    const {error} = await testCommand(
      DatasetImportCommand,
      ['test/fixtures/employees.ndjson', '-p', 'test-project', '-d', 'test-dataset'],
      {mocks: defaultMocks},
    )

    expect(error?.message).toContain('`--token` is required')
    expect(error?.oclif?.exit).toBe(1)
  })

  test('surfaces import errors from sanityImport', async () => {
    mocks.sanityImport.mockRejectedValue(
      new Error("ENOENT: no such file or directory, open '/nonexistent/file.ndjson'"),
    )

    const {error} = await testCommand(DatasetImportCommand, defaultArgs, {mocks: defaultMocks})

    expect(error?.message).toContain('ENOENT')
    expect(error?.oclif?.exit).toBe(1)
  })

  test('rejects file with unicode replacement character', async () => {
    mocks.sanityImport.mockRejectedValue(
      new ReplacementCharError(
        'Unicode replacement character (U+FFFD) found in document "doc2" at path "title"',
      ),
    )

    const {error} = await testCommand(DatasetImportCommand, defaultArgs, {mocks: defaultMocks})

    expect(error?.message).toContain('unicode replacement character')
    expect(error?.message).toContain('If you are certain you want to proceed')
    expect(error?.message).toContain('--allow-replacement-characters')
  })

  test('errors when --replace and --missing are both set', async () => {
    const {error} = await testCommand(
      DatasetImportCommand,
      [...defaultArgs, '--replace', '--missing'],
      {mocks: defaultMocks},
    )

    expect(error?.message).toMatch(/--replace.*--missing|--missing.*--replace/)
  })

  test('errors when source argument is missing', async () => {
    const {error} = await testCommand(
      DatasetImportCommand,
      ['-p', 'test-project', '-d', 'test-dataset', '-t', 'test-token'],
      {mocks: defaultMocks},
    )

    expect(error?.message).toContain('Missing 1 required arg')
    expect(error?.message).toContain('source')
  })

  test('imports ndjson file successfully', async () => {
    mocks.sanityImport.mockResolvedValue({numDocs: 2, warnings: []})

    const {error, stdout} = await testCommand(DatasetImportCommand, defaultArgs, {
      mocks: defaultMocks,
    })

    expect(error).toBeUndefined()
    expect(stdout).toContain('Done! Imported 2 documents')
    expect(stdout).toContain('test-dataset')
  })

  test('imports with --replace flag', async () => {
    mocks.sanityImport.mockResolvedValue({numDocs: 1, warnings: []})

    const {error} = await testCommand(DatasetImportCommand, [...defaultArgs, '--replace'], {
      mocks: defaultMocks,
    })

    expect(error).toBeUndefined()
    expect(mocks.sanityImport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({operation: 'createOrReplace'}),
    )
  })

  test('imports with --missing flag', async () => {
    mocks.sanityImport.mockResolvedValue({numDocs: 1, warnings: []})

    const {error} = await testCommand(DatasetImportCommand, [...defaultArgs, '--missing'], {
      mocks: defaultMocks,
    })

    expect(error).toBeUndefined()
    expect(mocks.sanityImport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({operation: 'createIfNotExists'}),
    )
  })

  test('passes correct options to sanityImport', async () => {
    mocks.sanityImport.mockResolvedValue({numDocs: 0, warnings: []})

    const {error} = await testCommand(
      DatasetImportCommand,
      [
        ...defaultArgs,
        '--allow-failing-assets',
        '--skip-cross-dataset-references',
        '--allow-system-documents',
        '--replace-assets',
        '--asset-concurrency',
        '5',
      ],
      {mocks: defaultMocks},
    )

    expect(error).toBeUndefined()
    expect(mocks.sanityImport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowFailingAssets: true,
        allowSystemDocuments: true,
        assetConcurrency: 5,
        replaceAssets: true,
        skipCrossDatasetReferences: true,
      }),
    )
  })

  test('prints asset failure warnings', async () => {
    mocks.sanityImport.mockResolvedValue({
      numDocs: 1,
      warnings: [
        {documentId: 'doc1', message: 'Failed to import document', path: 'title', type: 'document'},
        {message: 'Failed to upload', type: 'asset', url: 'https://example.com/image.png'},
        {message: 'Failed to upload', type: 'asset', url: 'https://example.com/file.pdf'},
      ],
    })

    const {error, stderr} = await testCommand(DatasetImportCommand, defaultArgs, {
      mocks: defaultMocks,
    })

    expect(error).toBeUndefined()
    expect(stderr).toContain('https://example.com/image.png')
    expect(stderr).toContain('https://example.com/file.pdf')
    expect(stderr).not.toContain('Failed to import document')
  })

  test('passes --allow-replacement-characters to sanityImport', async () => {
    mocks.sanityImport.mockResolvedValue({numDocs: 1, warnings: []})

    const {error} = await testCommand(
      DatasetImportCommand,
      [...defaultArgs, '--allow-replacement-characters'],
      {mocks: defaultMocks},
    )

    expect(error).toBeUndefined()
    expect(mocks.sanityImport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({allowReplacementCharacters: true}),
    )
  })
})
