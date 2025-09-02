#!/usr/bin/env node
/* eslint-disable no-console, no-process-env */

import type {SanityClient} from '@sanity/client'
import {createClient} from '@sanity/client'
import fs from 'fs'
import {getIt} from 'get-it'
import {promise} from 'get-it/middleware'
import ora, {type Ora} from 'ora'
import path from 'path'
import prettyMs from 'pretty-ms'
import {parseArgs} from 'util'

import sanityImport from './import.js'
import type {GetItResponse, ImportOptions, ProgressEvent} from './types.js'
import {isReadableStream} from './util/streamTypeGuards.js'

interface CLIFlags {
  project?: string
  dataset?: string
  token?: string
  replace?: boolean
  missing?: boolean
  'allow-failing-assets'?: boolean
  'allow-assets-in-different-dataset'?: boolean
  'replace-assets'?: boolean
  'skip-cross-dataset-references'?: boolean
  'allow-system-documents'?: boolean
  'asset-concurrency'?: string
  help?: boolean
}

const red = (str: string): string => `\u001b[31m${str}\u001b[39m`
const yellow = (str: string): string => `\u001b[33m${str}\u001b[39m`
const printError = (str: string): void => console.error(red(`ERROR: ${str}`))

const helpText = `
  Usage
    $ sanity-import -p <projectId> -d <dataset> -t <token> sourceFile.ndjson

  Options
    -p, --project <projectId> Project ID to import to
    -d, --dataset <dataset> Dataset to import to
    -t, --token <token> Token to authenticate with
    --asset-concurrency <concurrency> Number of parallel asset imports
    --replace Replace documents with the same IDs
    --missing Skip documents that already exist
    --allow-failing-assets Skip assets that cannot be fetched/uploaded
    --replace-assets Skip reuse of existing assets
    --skip-cross-dataset-references Skips references to other datasets
    --help Show this help

  Rarely used options (should generally not be used)
    --allow-assets-in-different-dataset Allow asset documents to reference different project/dataset
    --allow-system-documents Imports system documents

  Examples
    # Import "./my-dataset.ndjson" into dataset "staging"
    $ sanity-import -p myPrOj -d staging -t someSecretToken my-dataset.ndjson

    # Import into dataset "test" from stdin, read token from env var
    $ cat my-dataset.ndjson | sanity-import -p myPrOj -d test -

  Environment variables (fallbacks for missing flags)
    --token = SANITY_IMPORT_TOKEN
`

const showHelp = (): void => {
  console.log(helpText)
  process.exit(0)
}

const {values: flags, positionals: input} = parseArgs({
  args: process.argv.slice(2),
  options: {
    project: {
      type: 'string',
      short: 'p',
    },
    dataset: {
      type: 'string',
      short: 'd',
    },
    token: {
      type: 'string',
      short: 't',
    },
    replace: {
      type: 'boolean',
      default: false,
    },
    missing: {
      type: 'boolean',
      default: false,
    },
    'allow-failing-assets': {
      type: 'boolean',
      default: false,
    },
    'allow-assets-in-different-dataset': {
      type: 'boolean',
      default: false,
    },
    'replace-assets': {
      type: 'boolean',
      default: false,
    },
    'skip-cross-dataset-references': {
      type: 'boolean',
      default: false,
    },
    'allow-system-documents': {
      type: 'boolean',
      default: false,
    },
    'asset-concurrency': {
      type: 'string',
    },
    help: {
      type: 'boolean',
      default: false,
    },
  },
  allowPositionals: true,
}) as {values: CLIFlags; positionals: string[]}

// Handle help flag
if (flags.help) {
  showHelp()
}

const {
  dataset,
  'allow-failing-assets': allowFailingAssets = false,
  'replace-assets': replaceAssets = false,
  'allow-assets-in-different-dataset': allowAssetsInDifferentDataset = false,
  'skip-cross-dataset-references': skipCrossDatasetReferences = false,
  'allow-system-documents': allowSystemDocuments = false,
} = flags
const token = flags.token || process.env.SANITY_IMPORT_TOKEN
const projectId = flags.project
const assetConcurrency = flags['asset-concurrency']
  ? parseInt(flags['asset-concurrency'], 10)
  : undefined
const source = input[0]

if (!projectId) {
  printError('Flag `--project` is required')
  showHelp()
}

if (!dataset) {
  printError('Flag `--dataset` is required')
  showHelp()
}

if (!token) {
  printError('Flag `--token` is required (or set SANITY_IMPORT_TOKEN)')
  showHelp()
}

if (!source) {
  printError('Source file is required, use `-` to read from stdin')
  showHelp()
}

let operation: 'create' | 'createIfNotExists' | 'createOrReplace' = 'create'
let releasesOperation: 'fail' | 'ignore' | 'replace' = 'fail'

if (flags.replace || flags.missing) {
  if (flags.replace && flags.missing) {
    printError('Cannot use both `--replace` and `--missing`')
    showHelp()
  }

  operation = flags.replace ? 'createOrReplace' : 'createIfNotExists'
  releasesOperation = flags.replace ? 'replace' : 'ignore'
}

let currentStep: string | undefined
let currentProgress: Ora | null = null
let stepStart: number
let spinInterval: NodeJS.Timeout | null

if (!projectId || !dataset || !token) {
  throw new Error('Required parameters missing')
}

const client: SanityClient = createClient({
  apiVersion: '2025-02-19',
  projectId,
  dataset,
  token,
  useCdn: false,
})

getStream()
  .then((stream) => {
    const assetsBase = getAssetsBase()
    const importOptions: ImportOptions = {
      client,
      operation,
      onProgress,
      allowFailingAssets: allowFailingAssets || false,
      allowAssetsInDifferentDataset: allowAssetsInDifferentDataset || false,
      skipCrossDatasetReferences: skipCrossDatasetReferences || false,
      allowSystemDocuments: allowSystemDocuments || false,
      replaceAssets: replaceAssets || false,
      releasesOperation,
      tag: '',
      targetProjectId: projectId,
      targetDataset: dataset,
    }

    if (assetsBase) {
      importOptions.assetsBase = assetsBase
    }

    if (assetConcurrency !== undefined) {
      importOptions.assetConcurrency = assetConcurrency
    }

    if (!isReadableStream(stream)) {
      throw new Error('Invalid stream type - expected readable stream')
    }
    return sanityImport(stream, importOptions)
  })
  .then(({numDocs, warnings}) => {
    const timeSpent = prettyMs(Date.now() - stepStart, {secondsDecimalDigits: 2})
    if (currentProgress) {
      currentProgress.text = `[100%] ${currentStep} (${timeSpent})`
      currentProgress.succeed()
    }

    console.log('Done! Imported %d documents to dataset "%s"\n', numDocs, dataset)
    printWarnings(warnings)
  })
  .catch((err: Error) => {
    if (currentProgress) {
      currentProgress.fail()
    }

    printError(err.stack || err.message)
  })

function printWarnings(warnings: Array<{message: string; type?: string; url?: string}>): void {
  const assetFails = warnings.filter((warn) => warn.type === 'asset')

  if (!assetFails.length) {
    return
  }

  console.warn(
    yellow('⚠ Failed to import the following %s:'),
    assetFails.length > 1 ? 'assets' : 'asset',
  )

  warnings.forEach((warning) => {
    console.warn(`  ${warning.url}`)
  })
}

async function getStream(): Promise<ReadableStream | NodeJS.ReadableStream> {
  if (!source) {
    throw new Error('Source is required')
  }

  if (/^https:\/\//i.test(source)) {
    return getUriStream(source)
  }

  return source === '-' ? process.stdin : fs.createReadStream(source)
}

function getAssetsBase(): string | undefined {
  if (!source || /^https:\/\//i.test(source) || source === '-') {
    return undefined
  }

  try {
    const fileStats = fs.statSync(source)
    const sourceIsFolder = fileStats.isDirectory()
    return sourceIsFolder ? source : path.dirname(source)
  } catch {
    return undefined
  }
}

const request = getIt([promise()])

async function getUriStream(uri: string): Promise<NodeJS.ReadableStream> {
  try {
    const response = (await request({url: uri, stream: true})) as GetItResponse
    return response.body
  } catch (err) {
    throw new Error(`Error fetching source:\n${(err as Error).message}`)
  }
}

function onProgress(opts: ProgressEvent): void {
  const lengthComputable = opts.total
  const sameStep = opts.step == currentStep
  const percent = getPercentage(opts)

  if (lengthComputable && opts.total === opts.current) {
    if (spinInterval) {
      clearInterval(spinInterval)
      spinInterval = null
    }
  }

  if (sameStep && !lengthComputable) {
    return
  }

  if (sameStep) {
    const timeSpent = prettyMs(Date.now() - stepStart, {secondsDecimalDigits: 2})
    if (currentProgress) {
      currentProgress.text = `${percent}${opts.step} (${timeSpent})`
      currentProgress.render()
    }
    return
  }

  // Moved to a new step
  const prevStep = currentStep
  const prevStepStart = stepStart
  stepStart = Date.now()
  currentStep = opts.step

  if (spinInterval) {
    clearInterval(spinInterval)
    spinInterval = null
  }

  if (currentProgress) {
    const timeSpent = prettyMs(Date.now() - prevStepStart, {
      secondsDecimalDigits: 2,
    })
    currentProgress.text = `[100%] ${prevStep} (${timeSpent})`
    currentProgress.succeed()
  }

  currentProgress = ora(`[0%] ${opts.step} (0.00s)`).start()

  if (!lengthComputable) {
    spinInterval = setInterval(() => {
      const timeSpent = prettyMs(Date.now() - stepStart, {
        secondsDecimalDigits: 2,
      })
      if (currentProgress) {
        currentProgress.text = `${percent}${opts.step} (${timeSpent})`
        currentProgress.render()
      }
    }, 60)
  }
}

function getPercentage(opts: ProgressEvent): string {
  if (!opts.total) {
    return ''
  }

  const percent = Math.floor(((opts.current || 0) / opts.total) * 100)
  return `[${percent}%] `
}
