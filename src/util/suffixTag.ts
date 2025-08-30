export default (tag: string, suffix: string): string => `${tag.replace(/\.+$/, '')}.${suffix}`
