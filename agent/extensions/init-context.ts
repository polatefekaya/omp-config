import fs from 'fs/promises'
import path from 'path'
import { execSync } from 'child_process'

interface RepoData {
  projectType: 'dotnet' | 'frontend' | 'mixed' | 'unknown'
  directoryTree: string
  csprojFiles: CsprojData[]
  packageJson: PackageJsonData | null
  programCs: string | null
  massTransitConfig: string | null
  dbContextFiles: string[]
  existingAgentsMd: string | null
}

interface CsprojData {
  name: string
  packages: string[]
  targetFramework: string | null
}

interface PackageJsonData {
  name: string
  dependencies: string[]
  devDependencies: string[]
  scripts: Record<string, string>
}

async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

function safeExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

async function findFiles(cwd: string, predicate: (name: string) => boolean, maxDepth = 5): Promise<string[]> {
  const results: string[] = []

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (predicate(entry.name)) results.push(full)
    }
  }

  await walk(cwd, 0)
  return results
}

async function parseCsproj(filePath: string): Promise<CsprojData> {
  const content = await safeRead(filePath) ?? ''
  const packages: string[] = []

  for (const match of content.matchAll(/<PackageReference Include="([^"]+)"/g)) {
    packages.push(match[1])
  }

  const frameworkMatch = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/)

  return {
    name: path.basename(filePath, '.csproj'),
    packages,
    targetFramework: frameworkMatch?.[1] ?? null,
  }
}

async function gatherRepoData(cwd: string): Promise<RepoData> {
  const entries = await fs.readdir(cwd).catch(() => [] as string[])
  const isDotnet = entries.some(e => e.endsWith('.csproj') || e.endsWith('.sln'))
  const isFrontend = entries.includes('package.json')

  const projectType = isDotnet && isFrontend ? 'mixed'
    : isDotnet ? 'dotnet'
    : isFrontend ? 'frontend'
    : 'unknown'

  const directoryTree = safeExec(
    'find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/bin/*" -not -path "*/obj/*" -not -path "*/.omp/*" | head -80',
    cwd
  )

  const csprojFilePaths = await findFiles(cwd, n => n.endsWith('.csproj'))
  const csprojFiles = await Promise.all(csprojFilePaths.map(parseCsproj))

  let packageJson: PackageJsonData | null = null
  const pkgRaw = await safeRead(path.join(cwd, 'package.json'))
  if (pkgRaw) {
    const pkg = JSON.parse(pkgRaw)
    packageJson = {
      name: pkg.name ?? '',
      dependencies: Object.keys(pkg.dependencies ?? {}),
      devDependencies: Object.keys(pkg.devDependencies ?? {}),
      scripts: pkg.scripts ?? {},
    }
  }

  const programCsPaths = await findFiles(cwd, n => n === 'Program.cs')
  const programCs = programCsPaths.length > 0 ? await safeRead(programCsPaths[0]) : null

  const massTransitFiles = await findFiles(cwd, n =>
    n.toLowerCase().includes('masstransit') || n.toLowerCase().includes('messaging')
  )
  const massTransitConfig = massTransitFiles.length > 0
    ? await safeRead(massTransitFiles[0])
    : null

  const dbContextPaths = await findFiles(cwd, n => n.endsWith('DbContext.cs'))
  const dbContextFiles = await Promise.all(
    dbContextPaths.slice(0, 3).map(p => safeRead(p).then(c => c ?? ''))
  )

  const existingAgentsMd = await safeRead(path.join(cwd, 'AGENTS.md'))
    ?? await safeRead(path.join(cwd, '.omp', 'CONTEXT.md'))

  return {
    projectType,
    directoryTree,
    csprojFiles,
    packageJson,
    programCs: programCs?.slice(0, 3000) ?? null,
    massTransitConfig: massTransitConfig?.slice(0, 2000) ?? null,
    dbContextFiles: dbContextFiles.map(c => c.slice(0, 1500)),
    existingAgentsMd,
  }
}

function buildPrompt(cwd: string, data: RepoData): string {
  const sections: string[] = []

  sections.push(`You are analyzing a repository at: ${cwd}`)
  sections.push(`Project type: ${data.projectType}`)

  sections.push(`## Directory Structure\n${data.directoryTree}`)

  if (data.csprojFiles.length > 0) {
    const csprojInfo = data.csprojFiles.map(p =>
      `- ${p.name} (${p.targetFramework ?? 'unknown framework'})\n  Packages: ${p.packages.slice(0, 15).join(', ')}`
    ).join('\n')
    sections.push(`## .NET Projects\n${csprojInfo}`)
  }

  if (data.packageJson) {
    sections.push(
      `## Frontend Package (${data.packageJson.name})\n` +
      `Dependencies: ${data.packageJson.dependencies.join(', ')}\n` +
      `Dev dependencies: ${data.packageJson.devDependencies.join(', ')}\n` +
      `Scripts: ${Object.entries(data.packageJson.scripts).map(([k, v]) => `${k}: ${v}`).join(', ')}`
    )
  }

  if (data.programCs) {
    sections.push(`## Program.cs\n\`\`\`csharp\n${data.programCs}\n\`\`\``)
  }

  if (data.massTransitConfig) {
    sections.push(`## MassTransit Configuration\n\`\`\`csharp\n${data.massTransitConfig}\n\`\`\``)
  }

  if (data.dbContextFiles.length > 0) {
    sections.push(`## DbContext Files\n${data.dbContextFiles.map(c => `\`\`\`csharp\n${c}\n\`\`\``).join('\n')}`)
  }

  if (data.existingAgentsMd) {
    sections.push(`## Existing Context (to update, not replace)\n${data.existingAgentsMd}`)
  }

  return `
${sections.join('\n\n')}

---

Based on the above, generate a comprehensive CONTEXT.md file for this repository.
The file will be placed at .omp/CONTEXT.md and read by an AI coding agent at the start of every session.

The output must follow this exact structure. Fill in every section based on what you actually found.
Do not leave placeholder text — if you cannot determine something, say "Not detected" rather than leaving a template.

\`\`\`markdown
# Service: [name from csproj or package.json]

## What This Service Does
[1-2 sentences describing the business domain based on project name, folder names, and file contents]

## Project Type
[dotnet-microservice | frontend-react | frontend-solid | frontend-nextjs | frontend-vite | mixed]

## Contracts Source Path
[path to shared contracts library if detected, otherwise: Not applicable]
Current contracts version: [version from csproj PackageReference if detected]

<!-- AGENT-MAINTAINED: update after each session if anything changed -->
## Patterns In Use
- Mediator: [yes — Mediator.SourceGenerators / no — direct dispatch / not detected]
- MassTransit: [yes — with outbox / yes — without outbox / no / not detected]
- DbContext name and path: [detected name and file path]
- EF Core provider: [Npgsql.PostgreSQL / other / not detected]
- Caching: [Garnet/Redis via StackExchange.Redis / IDistributedCache / none detected]
- Authentication: [detected auth packages / none detected]
- ActivitySource name: [detected registered source name / not detected]

## Key Entry Points
[List detected entry points: Program.cs location, API project, worker projects, etc.]

## Consumers
[List detected MassTransit consumers with their message type if found, otherwise: None detected]

## Key Aggregates / Entities
[List detected EF Core entities from DbContext, otherwise: Not detected]

## Frontend Stack
[List detected: React/Solid/Next.js/Vite, Tailwind version, state management, data fetching]
Or: Not a frontend project

## NuGet / npm Packages of Note
[List the most significant packages detected — not all, just the ones that matter for architecture]

## Known Fragile Areas
[Leave empty — agent will populate this over time]

## Last Updated
[Today's date] — Initial generation by /init-context
<!-- END AGENT-MAINTAINED -->
\`\`\`

Output only the markdown content between the triple backticks. No explanation before or after.
`.trim()
}

export default function(pi: any) {
 pi.registerCommand('init-context', {
   description: 'Scan this repo and generate .omp/CONTEXT.md',
    async handler(_args: any, ctx: any) {
      try {
        const cwd = process.cwd()
        ctx.ui.setStatus?.('init-context', 'Scanning repository...')

        const data = await gatherRepoData(cwd)
        const prompt = buildPrompt(cwd, data)

        ctx.ui.setStatus?.('init-context', 'Generating CONTEXT.md...')

        const ompDir = path.join(cwd, '.omp')
        await fs.mkdir(ompDir, { recursive: true })

        const contextPath = path.join(ompDir, 'CONTEXT.md')
        const existing = await safeRead(contextPath)

        if (existing) {
          const backupPath = path.join(ompDir, 'CONTEXT.md.bak')
          await fs.writeFile(backupPath, existing)
        }

        await fs.writeFile(contextPath, prompt)
        await pi.sendUserMessage(prompt)

        ctx.ui.setStatus?.('init-context', '')
      } catch (err: any) {
        ctx.ui.notify?.(`init-context failed: ${err.message}`, 'error')
      }
    },
 })
}