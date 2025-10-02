import type {ProgressEvent} from '../types.js'

interface ProgressStepperOptions {
  step: string
  total: number
}

function progressStepper<T>(
  onProgress: (event: ProgressEvent) => void,
  options: ProgressStepperOptions,
): (inp?: T) => T {
  let current = -1

  // Stepper function which increments progress up to defined total and returns
  // input argument verbatim so it may be used in the middle of a promise chain
  const step = (inp?: T): T => {
    onProgress({
      step: options.step,
      total: options.total,
      current: Math.min(++current, options.total),
    })

    return inp as T
  }

  step()
  return step
}

export {progressStepper}
