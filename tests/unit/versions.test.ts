import { describe, expect, it } from 'vitest'
import { newerThan, repoSlug } from '@shared/versions'

describe('update helpers', () => {
  it('extracts the GitHub slug and rejects placeholders', () => {
    expect(repoSlug('https://github.com/acme/gitclient.git')).toBe('acme/gitclient')
    expect(repoSlug('git@github.com:acme/gitclient.git')).toBe('acme/gitclient')
    expect(repoSlug('https://github.com/<OWNER>/<REPO>.git')).toBeNull()
    expect(repoSlug('https://gitlab.com/a/b')).toBeNull()
  })

  it('compares versions', () => {
    expect(newerThan('0.2.0', '0.1.9')).toBe(true)
    expect(newerThan('1.0.0', '1.0.0')).toBe(false)
    expect(newerThan('v1.10.0', '1.9.3')).toBe(true)
    expect(newerThan('1.0.0', '1.0.0-beta.1')).toBe(true)
    expect(newerThan('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true)
    expect(newerThan('0.9.0', '1.0.0')).toBe(false)
  })
})
