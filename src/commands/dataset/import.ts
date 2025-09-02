/* eslint-disable no-console, no-process-env */

import {Args, Command, Flags} from '@oclif/core'
import type {SanityClient} from '@sanity/client'
import {createClient} from '@sanity/client'
import fs from 'fs'
import {getIt} from 'get-it'
import {promise} from 'get-it/middleware'
import ora from 'ora'
import path from 'path'
import prettyMs from 'pretty-ms'

import sanityImport from '../../import.js'
import type {ImportOptions, ProgressEvent} from '../../types.js'

const red = (str: string): string => `\u001b[31m${str}\u001b[39m`
const yellow = (str: string): string => `\u001b[33m${str}\u001b[39m`
const printError = (str: string): void => console.error(red(`ERROR: ${str}`))

export default class DatasetImportCommand extends Command {
  static description = 'Import documents to a Sanity dataset'

  static examples = [
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

  static flags = {
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
    'allow-system-documents': Flags.boolean({
      description: 'Imports system documents',
      default: false,
    }),
    'asset-concurrency': Flags.integer({
      description: 'Number of parallel asset imports',
    }),
  }

  static args = {
    source: Args.string({
      description: 'Source file (use "-" for stdin)',
      required: true,
    }),
  }

  private currentStep?: string
  private currentProgress?: any
  private stepStart?: number
  private spinInterval?: NodeJS.Timeout | null

  async run(): Promise<void> {
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
      'allow-system-documents': allowSystemDocuments,
      'asset-concurrency': assetConcurrency,
    } = flags

    const {source} = args

    const tokenString = Array.isArray(token) ? token[0] : token

    if (!tokenString) {
      printError('Flag `--token` is required (or set SANITY_IMPORT_TOKEN)')
      this.exit(1)
    }

    let operation: 'create' | 'createIfNotExists' | 'createOrReplace' = 'create'
    let releasesOperation: 'fail' | 'ignore' | 'replace' = 'fail'

    if (replace || missing) {
      operation = replace ? 'createOrReplace' : 'createIfNotExists'
      releasesOperation = replace ? 'replace' : 'ignore'
    }

    const client: SanityClient = createClient({
      apiVersion: '2025-02-19',
      projectId,
      dataset,
      token: tokenString,
      useCdn: false,
      requestTagPrefix: 'sanity.cli',
    })

    try {
      const stream = await this.getStream(source)
      const assetsBase = this.getAssetsBase(source)

      const importOptions: ImportOptions = {
        client,
        operation,
        onProgress: this.onProgress.bind(this),
        allowFailingAssets: allowFailingAssets || false,
        allowAssetsInDifferentDataset: allowAssetsInDifferentDataset || false,
        skipCrossDatasetReferences: skipCrossDatasetReferences || false,
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

      console.log('Done! Imported %d documents to dataset "%s"\n', numDocs, dataset)
      this.printWarnings(warnings)
    } catch (err) {
      if (this.currentProgress) {
        this.currentProgress.fail()
      }

      printError((err as Error).stack || (err as Error).message)
      this.exit(1)
    }
  }

  private printWarnings(warnings: Array<{message: string; type?: string; url?: string}>): void {
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

  private async getStream(source: string): Promise<ReadableStream | NodeJS.ReadableStream> {
    if (/^https:\/\//i.test(source)) {
      return this.getUriStream(source)
    }

    return source === '-' ? process.stdin : fs.createReadStream(source)
  }

  private getAssetsBase(source: string): string | undefined {
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

  private async getUriStream(uri: string): Promise<NodeJS.ReadableStream> {
    const request = getIt([promise()])

    try {
      const response = await request({url: uri, stream: true})
      return response.body
    } catch (err) {
      throw new Error(`Error fetching source:\n${(err as Error).message}`)
    }
  }

  private onProgress(opts: ProgressEvent): void {
    const lengthComputable = opts.total
    const sameStep = opts.step === this.currentStep
    const percent = this.getPercentage(opts)

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

    this.currentProgress = ora(`[0%] ${opts.step} (0.00s)`).start()

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

  private getPercentage(opts: ProgressEvent): string {
    if (!opts.total) {
      return ''
    }

    const percent = Math.floor(((opts.current || 0) / opts.total) * 100)
    return `[${percent}%] `
  }
}
