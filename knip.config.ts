import {type KnipConfig} from 'knip'

const project = ['src/**/*.{js,jsx,ts,tsx}', '!**/docs/**']

const baseConfig = {
  entry: ['src/_exports/index.ts'],
  project,
} satisfies KnipConfig

export default baseConfig
