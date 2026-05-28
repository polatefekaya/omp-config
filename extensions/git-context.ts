import { execSync } from 'child_process'

function safeExec(cmd: string): string {
  try {
    return execSync(cmd, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return ''
  }
}

export default function(pi: any) {
  pi.on('session_start', async (ctx: any) => {
    const branch = safeExec('git branch --show-current')
    if (!branch) return

    const dirty = safeExec('git status --short')
    const log = safeExec('git log --oneline -5')
    const stash = safeExec('git stash list --count 2>/dev/null || git stash list | wc -l')
    const remote = safeExec('git remote get-url origin 2>/dev/null')
    const unpushed = safeExec('git log @{u}.. --oneline 2>/dev/null')

    const lines: string[] = [
      `## Git State`,
      `Branch: ${branch}`,
    ]

    if (remote) lines.push(`Remote: ${remote}`)

    if (dirty) {
      lines.push(`\nDirty files:\n${dirty}`)
    } else {
      lines.push(`Working tree: clean`)
    }

    if (unpushed) {
      lines.push(`\nUnpushed commits:\n${unpushed}`)
    }

    if (log) {
      lines.push(`\nRecent commits:\n${log}`)
    }

    if (stash && stash !== '0') {
      lines.push(`\nStashed changes: ${stash}`)
    }

    ctx.session.appendSystemText(lines.join('\n'))
  })
}