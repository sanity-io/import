import {Args, Flags} from '@oclif/core'
import {getProjectCliClient, SanityCommand} from '@sanity/cli-core'
import {spinner} from '@sanity/cli-core/ux'
import fs from 'fs'
import {getIt} from 'get-it'
import {promise} from 'get-it/middleware'
import path from 'path'
import prettyMs from 'pretty-ms'

import {sanityImport} from '../../import.js'
import type {ImportOptions, ProgressEvent} from '../../types.js'
import {ReplacementCharError} from '../../util/validateReplacementCharacters.js'

function getAssetsBase(source: string): string | undefined {
  if (/^https:\/\//i.test(source) || source === '-') {
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

async function getUriStream(uri: string): Promise<NodeJS.ReadableStream> {
  const request = getIt([promise()])

  try {
    const response = (await request({url: uri, stream: true})) as {body: NodeJS.ReadableStream}
    return response.body
  } catch (err) {
    throw new Error(`Error fetching source:\n${(err as Error).message}`)
  }
}

function getPercentage(opts: ProgressEvent): string {
  if (!opts.total) {
    return ''
  }

  const percent = Math.floor(((opts.current || 0) / opts.total) * 100)
  return `[${percent}%] `
}

export class DatasetImportCommand extends SanityCommand<typeof DatasetImportCommand> {
  static override description = 'Import documents to a Sanity dataset'

  static override examples = [
    {
      description: 'Import "./my-dataset.ndjson" into dataset "staging"',
      command:
        '<%= config.bin %> <%= command.id %> -p myPrOj -d staging -t someSecretToken my-dataset.ndjson',
    },
    {
      description: 'Import into dataset "test" from stdin, read token from env var',
      command: 'cat my-dataset.ndjson | <%= config.bin %> <%= command.id %> -p myPrOj -d test -',
    },
  ]

  static override flags = {
    project: Flags.string({
      char: 'p',
      description: 'Project ID to import to',
      required: true,
    }),
    dataset: Flags.string({
      char: 'd',
      description: 'Dataset to import to',
      required: true,
    }),
    token: Flags.string({
      char: 't',
      description: 'Token to authenticate with',
      required: false,
      env: 'SANITY_IMPORT_TOKEN',
    }),
    replace: Flags.boolean({
      description: 'Replace documents with the same IDs',
      default: false,
      exclusive: ['missing'],
    }),
    missing: Flags.boolean({
      description: 'Skip documents that already exist',
      default: false,
      exclusive: ['replace'],
    }),
    'allow-failing-assets': Flags.boolean({
      description: 'Skip assets that cannot be fetched/uploaded',
      default: false,
    }),
    'allow-assets-in-different-dataset': Flags.boolean({
      description: 'Allow asset documents to reference different project/dataset',
      default: false,
    }),
    'replace-assets': Flags.boolean({
      description: 'Skip reuse of existing assets',
      default: false,
    }),
    'skip-cross-dataset-references': Flags.boolean({
      description: 'Skips references to other datasets',
      default: false,
    }),
    'allow-replacement-characters': Flags.boolean({
      description: 'Allow unicode replacement characters in imported documents',
      default: false,
    }),
    'allow-system-documents': Flags.boolean({
      description: 'Imports system documents',
      default: false,
    }),
    'asset-concurrency': Flags.integer({
      description: 'Number of parallel asset imports',
    }),
  }

  static override args = {
    source: Args.string({
      description: 'Source file (use "-" for stdin)',
      required: true,
    }),
  }

  private currentStep?: string
  private currentProgress?: ReturnType<typeof spinner>
  private stepStart?: number
  private spinInterval?: NodeJS.Timeout | null

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(DatasetImportCommand)

    const {
      project: projectId,
      dataset,
      token,
      replace,
      missing,
      'allow-failing-assets': allowFailingAssets,
      'allow-assets-in-different-dataset': allowAssetsInDifferentDataset,
      'replace-assets': replaceAssets,
      'skip-cross-dataset-references': skipCrossDatasetReferences,
      'allow-replacement-characters': allowReplacementCharacters,
      'allow-system-documents': allowSystemDocuments,
      'asset-concurrency': assetConcurrency,
    } = flags

    const {source} = args

    const tokenString: string | undefined = token
    if (!tokenString) {
      this.error('Flag `--token` is required (or set SANITY_IMPORT_TOKEN)', {exit: 1})
    }

    let operation: 'create' | 'createIfNotExists' | 'createOrReplace' = 'create'
    let releasesOperation: 'fail' | 'ignore' | 'replace' = 'fail'

    if (replace || missing) {
      operation = replace ? 'createOrReplace' : 'createIfNotExists'
      releasesOperation = replace ? 'replace' : 'ignore'
    }

    const client = await getProjectCliClient({
      apiVersion: 'v2025-02-19',
      projectId,
      dataset,
      token: tokenString,
    })

    try {
      const stream = await DatasetImportCommand.getStream(source)
      const assetsBase = getAssetsBase(source)

      const importOptions: ImportOptions = {
        client,
        operation,
        onProgress: this.onProgress.bind(this),
        allowFailingAssets: allowFailingAssets || false,
        allowAssetsInDifferentDataset: allowAssetsInDifferentDataset || false,
        skipCrossDatasetReferences: skipCrossDatasetReferences || false,
        allowReplacementCharacters: allowReplacementCharacters || false,
        allowSystemDocuments: allowSystemDocuments || false,
        replaceAssets: replaceAssets || false,
        releasesOperation,
        tag: 'sanity.import',
        targetProjectId: projectId,
        targetDataset: dataset,
      }

      if (assetsBase) {
        importOptions.assetsBase = assetsBase
      }

      if (assetConcurrency !== undefined) {
        importOptions.assetConcurrency = assetConcurrency
      }

      const {numDocs, warnings} = await sanityImport(stream as NodeJS.ReadableStream, importOptions)

      if (this.stepStart) {
        const timeSpent = prettyMs(Date.now() - this.stepStart, {secondsDecimalDigits: 2})
        if (this.currentProgress) {
          this.currentProgress.text = `[100%] ${this.currentStep} (${timeSpent})`
          this.currentProgress.succeed()
        }
      }

      this.log('Done! Imported %d documents to dataset "%s"\n', numDocs, dataset)
      this.printWarnings(warnings)
    } catch (err) {
      if (this.currentProgress) {
        this.currentProgress.fail()
      }

      if (err instanceof ReplacementCharError) {
        this.error(
          `Import failed due to unicode replacement characters in the data.\n${err.message}\n\nIf you are certain you want to proceed with the import despite potentially corrupt data, re-run the import with the \`--allow-replacement-characters\` flag set.`,
          {exit: 1},
        )
      } else {
        this.error((err as Error).stack || (err as Error).message, {exit: 1})
      }
    }
  }

  private printWarnings(warnings: Array<{message: string; type?: string; url?: string}>): void {
    const assetFails = warnings.filter((warn) => warn.type === 'asset')

    if (!assetFails.length) {
      return
    }

    this.warn(`Failed to import the following ${assetFails.length > 1 ? 'assets' : 'asset'}:`)

    warnings.forEach((warning) => {
      this.warn(`  ${warning.url}`)
    })
  }

  private static async getStream(source: string): Promise<ReadableStream | NodeJS.ReadableStream> {
    if (/^https:\/\//i.test(source)) {
      return getUriStream(source)
    }

    return source === '-' ? process.stdin : fs.createReadStream(source)
  }

  private onProgress(opts: ProgressEvent): void {
    const lengthComputable = opts.total
    const sameStep = opts.step === this.currentStep
    const percent = getPercentage(opts)

    if (lengthComputable && opts.total === opts.current) {
      if (this.spinInterval) {
        clearInterval(this.spinInterval)
        this.spinInterval = null
      }
    }

    if (sameStep && !lengthComputable) {
      return
    }

    if (sameStep) {
      if (this.stepStart) {
        const timeSpent = prettyMs(Date.now() - this.stepStart, {secondsDecimalDigits: 2})
        if (this.currentProgress) {
          this.currentProgress.text = `${percent}${opts.step} (${timeSpent})`
          this.currentProgress.render()
        }
      }
      return
    }

    // Moved to a new step
    const prevStep = this.currentStep
    const prevStepStart = this.stepStart
    this.stepStart = Date.now()
    this.currentStep = opts.step

    if (this.spinInterval) {
      clearInterval(this.spinInterval)
      this.spinInterval = null
    }

    if (this.currentProgress && this.currentProgress.succeed && prevStepStart) {
      const timeSpent = prettyMs(Date.now() - prevStepStart, {
        secondsDecimalDigits: 2,
      })
      this.currentProgress.text = `[100%] ${prevStep} (${timeSpent})`
      this.currentProgress.succeed()
    }

    this.currentProgress = spinner(`[0%] ${opts.step} (0.00s)`).start()

    if (!lengthComputable) {
      this.spinInterval = setInterval(() => {
        if (this.stepStart && this.currentProgress) {
          const timeSpent = prettyMs(Date.now() - this.stepStart, {
            secondsDecimalDigits: 2,
          })
          this.currentProgress.text = `${percent}${opts.step} (${timeSpent})`
          this.currentProgress.render()
        }
      }, 60)
    }
  }
}
