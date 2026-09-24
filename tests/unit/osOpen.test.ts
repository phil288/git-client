import { describe, expect, it } from 'vitest'
import { tokenizeCommand } from '../../src/main/osOpen'

describe('tokenizeCommand', () => {
  it('splits on whitespace and honours quotes', () => {
    expect(tokenizeCommand('code --new-window')).toEqual(['code', '--new-window'])
    expect(tokenizeCommand('"C:\\Program Files\\Editor\\ed.exe" -n')).toEqual(['C:\\Program Files\\Editor\\ed.exe', '-n'])
    expect(tokenizeCommand("idea  'my arg'  ''")).toEqual(['idea', 'my arg', ''])
    expect(tokenizeCommand('   ')).toEqual([])
  })

  it('does not interpret shell metacharacters', () => {
    expect(tokenizeCommand('code; rm -rf /')).toEqual(['code;', 'rm', '-rf', '/'])
    expect(tokenizeCommand('code $(whoami)')).toEqual(['code', '$(whoami)'])
  })
})
