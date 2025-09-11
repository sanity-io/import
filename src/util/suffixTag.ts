export const suffixTag = (tag: string, suffix: string): string =>
  `${tag.replace(/\.+$/, '')}.${suffix}`
