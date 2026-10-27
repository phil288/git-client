import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { write } from '../helpers'

/**
 * Fake CLI (same seam as tests/integration/ai.test.ts): commit-message prompts get
 * `commitMessage`; conflict prompts get `resolve(markedFile)`'s output. Every
 * prompt is appended to <cli>.log so tests can see what was asked.
 */
export function fakeAiCli(bin: string, name: string, resolveBody = 'return keepBoth(file)', commitMessage = 'feat: work from the worktree'): string {
  const p = join(bin, `${name}.mjs`)
  write(bin, `${name}.mjs`, '')
  writeFileSync(
    p,
    `import { appendFileSync } from 'node:fs'
function keepBoth(file) {
  const out = []
  let mode = null
  for (const l of file.split('\\n')) {
    if (l.startsWith('<<<<<<< ')) mode = 'ours'
    else if (l.startsWith('||||||| ')) mode = 'base'
    else if (l === '=======') mode = 'theirs'
    else if (l.startsWith('>>>>>>> ')) mode = null
    else if (mode !== 'base') out.push(l)
  }
  return out.join('\\n')
}
function resolve(file) { ${resolveBody} }
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', async () => {
  const prompt = Buffer.concat(chunks).toString('utf8')
  appendFileSync(${JSON.stringify(p + '.log')}, prompt + '\\n<<END PROMPT>>\\n')
  const m = /--- BEGIN FILE ---\\n([\\s\\S]*)\\n--- END FILE ---/.exec(prompt)
  if (m) process.stdout.write(await resolve(m[1]))
  else process.stdout.write(${JSON.stringify(commitMessage)} + '\\n')
})
`
  )
  return p
}

/** Prompts the fake CLI received, in order. */
export const prompts = (cli: string): string[] => (existsSync(`${cli}.log`) ? readFileSync(`${cli}.log`, 'utf8').split('\n<<END PROMPT>>\n').filter(Boolean) : [])
