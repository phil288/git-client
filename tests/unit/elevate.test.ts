import { describe, expect, it } from 'vitest'
import { sudoChown, sudoFailure } from '../../src/main/elevate'

describe('sudoFailure', () => {
  it('maps a wrong password and a missing sudo right to AUTH_FAILED', () => {
    expect(sudoFailure('Sorry, try again.\nsudo: no password was provided\nsudo: 1 incorrect password attempt\n', 1)).toMatchObject({ code: 'AUTH_FAILED', message: 'Wrong sudo password.' })
    expect(sudoFailure('phil is not in the sudoers file.\n', 1)).toMatchObject({ code: 'AUTH_FAILED', message: 'This user is not allowed to use sudo.' })
  })
  it('keeps other failures as they are', () => {
    expect(sudoFailure("chown: cannot access '/x': No such file or directory\n", 1)).toMatchObject({ code: 'UNKNOWN', message: "sudo chown failed: chown: cannot access '/x': No such file or directory" })
    expect(sudoFailure('', null)).toMatchObject({ code: 'UNKNOWN', message: 'sudo chown failed (exit killed)' })
  })
})

describe('sudoChown', () => {
  it('refuses a multi-line password before spawning anything', async () => {
    if (process.platform === 'win32') return
    await expect(sudoChown('/tmp/x', 'a\nb')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})
