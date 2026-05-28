import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const SKILLS_DIR = path.join(os.homedir(), '.omp', 'skills')

type SkillFile =
  | 'dotnet-patterns.md'
  | 'masstransit.md'
  | 'efcore-postgresql.md'
  | 'api-design.md'
  | 'error-handling.md'
  | 'resilience.md'
  | 'background-services.md'
  | 'observability.md'
  | 'contracts-safety.md'
  | 'garnet-caching.md'
  | 'performance.md'
  | 'timezones.md'
  | 'codestyle.md'
  | 'frontend.md'
  | 'frontend-react.md'
  | 'frontend-solid.md'
  | 'frontend-nextjs.md'
  | 'frontend-vite.md'

interface SkillDetector {
  projectFiles?: string[]
  packageNames?: string[]
  keywords?: string[]
}

const DETECTORS: Record<SkillFile, SkillDetector> = {
  'codestyle.md': {
    keywords: [],
  },
  'dotnet-patterns.md': {
    projectFiles: ['.csproj', '.sln'],
    keywords: ['handler', 'command', 'query', 'feature', 'slice', 'endpoint', 'minimal api'],
  },
  'masstransit.md': {
    packageNames: ['MassTransit'],
    keywords: ['consumer', 'saga', 'publish', 'subscribe', 'message', 'bus', 'queue', 'outbox', 'masstransit'],
  },
  'efcore-postgresql.md': {
    packageNames: ['Microsoft.EntityFrameworkCore', 'Npgsql.EntityFrameworkCore.PostgreSQL'],
    keywords: ['entity', 'dbcontext', 'migration', 'relationship', 'table', 'column', 'owned', 'ef core', 'efcore'],
  },
  'api-design.md': {
    projectFiles: ['.csproj'],
    keywords: ['endpoint', 'route', 'api', 'http', 'request', 'response', 'minimal api', 'mapget', 'mappost'],
  },
  'error-handling.md': {
    keywords: ['error', 'exception', 'problem', 'fault', 'catch', 'throw', 'problemdetails', '404', '400', '500'],
  },
  'resilience.md': {
    packageNames: ['Polly', 'Microsoft.Extensions.Http.Resilience'],
    keywords: ['retry', 'circuit breaker', 'timeout', 'httpclient', 'resilience', 'polly', 'typed client'],
  },
  'background-services.md': {
    keywords: ['background', 'worker', 'hosted service', 'hostedservice', 'backgroundservice', 'job', 'scheduled', 'cron'],
  },
  'observability.md': {
    packageNames: ['OpenTelemetry'],
    keywords: ['activity', 'trace', 'span', 'telemetry', 'otel', 'signoz', 'metric', 'logging', 'activitysource'],
  },
  'contracts-safety.md': {
    keywords: ['contract', 'message type', 'nuget', 'shared library', 'package version', 'bump'],
  },
  'garnet-caching.md': {
    packageNames: ['StackExchange.Redis'],
    keywords: ['cache', 'caching', 'garnet', 'redis', 'ttl', 'invalidate', 'distributed cache'],
  },
  'performance.md': {
    keywords: ['slow', 'performance', 'n+1', 'optimize', 'fast', 'efficient', 'pagination', 'bulk', 'memory', 'allocation', 'throughput'],
  },
  'timezones.md': {
    keywords: ['timezone', 'datetime', 'dateonly', 'utc', 'offset', 'dst', 'datetimeoffset', 'local time', 'zone'],
  },
  'frontend.md': {
    projectFiles: ['package.json'],
    keywords: ['tailwind', 'zod', 'pnpm', 'typescript', 'frontend'],
  },
  'frontend-react.md': {
    packageNames: ['react'],
    keywords: ['react', 'hook', 'usestate', 'useeffect', 'usequery', 'zustand', 'react query', 'memo', 'jsx'],
  },
  'frontend-solid.md': {
    packageNames: ['solid-js'],
    keywords: ['solid', 'signal', 'createsignal', 'createeffect', 'createstore', 'reactive', 'solidjs'],
  },
  'frontend-nextjs.md': {
    packageNames: ['next'],
    keywords: ['next', 'nextjs', 'server component', 'app router', 'server action', 'route handler', 'use client', 'use server'],
  },
  'frontend-vite.md': {
    packageNames: ['vite'],
    keywords: ['vite', 'import.meta', 'vite_', 'vite config', 'vitest'],
  },
}

interface ProjectProfile {
  isDotnet: boolean
  isFrontend: boolean
  detectedPackages: Set<string>
}

async function readDotnetPackages(cwd: string): Promise<Set<string>> {
  const packages = new Set<string>()
  try {
    const entries = await fs.readdir(cwd, { recursive: true })
    const csprojFiles = (entries as string[]).filter(e => e.endsWith('.csproj')).slice(0, 5)
    for (const file of csprojFiles) {
      const content = await fs.readFile(path.join(cwd, file), 'utf-8')
      const matches = content.matchAll(/<PackageReference Include="([^"]+)"/g)
      for (const match of matches) packages.add(match[1])
    }
  } catch {
    // non-dotnet project
  }
  return packages
}

async function readNpmPackages(cwd: string): Promise<Set<string>> {
  const packages = new Set<string>()
  try {
    const content = await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')
    const pkg = JSON.parse(content)
    const allDeps = {
      ...pkg.dependencies ?? {},
      ...pkg.devDependencies ?? {},
    }
    for (const name of Object.keys(allDeps)) packages.add(name)
  } catch {
    // no package.json
  }
  return packages
}

async function detectProjectProfile(cwd: string): Promise<ProjectProfile> {
  const entries = await fs.readdir(cwd).catch(() => [] as string[])

  const isDotnet = entries.some(e => e.endsWith('.csproj') || e.endsWith('.sln'))
  const isFrontend = entries.includes('package.json')

  const detectedPackages = new Set<string>()

  if (isDotnet) {
    const dotnetPkgs = await readDotnetPackages(cwd)
    dotnetPkgs.forEach(p => detectedPackages.add(p))
  }
  if (isFrontend) {
    const npmPkgs = await readNpmPackages(cwd)
    npmPkgs.forEach(p => detectedPackages.add(p))
  }

  return { isDotnet, isFrontend, detectedPackages }
}

function getBaseSkills(profile: ProjectProfile): SkillFile[] {
  const skills: SkillFile[] = ['codestyle.md']

  if (profile.isDotnet) {
    skills.push('dotnet-patterns.md', 'api-design.md', 'error-handling.md', 'observability.md')
  }
  if (profile.isFrontend) {
    skills.push('frontend.md')
  }

  for (const [skill, detector] of Object.entries(DETECTORS) as [SkillFile, SkillDetector][]) {
    if (skills.includes(skill)) continue
    if (detector.packageNames?.some(pkg => profile.detectedPackages.has(pkg))) {
      skills.push(skill)
    }
  }

  return [...new Set(skills)]
}

function getMessageSkills(message: string, profile: ProjectProfile, loaded: Set<SkillFile>): SkillFile[] {
  const lower = message.toLowerCase()
  const toLoad: SkillFile[] = []

  for (const [skill, detector] of Object.entries(DETECTORS) as [SkillFile, SkillDetector][]) {
    if (loaded.has(skill)) continue
    if (!detector.keywords?.length) continue

    const relevant = detector.keywords.some(kw => lower.includes(kw))
    if (relevant) toLoad.push(skill)
  }

  return toLoad
}

async function readSkill(skillFile: SkillFile): Promise<string | null> {
  try {
    return await fs.readFile(path.join(SKILLS_DIR, skillFile), 'utf-8')
  } catch {
    return null
  }
}

export default function(pi: any) {
  const loadedSkills = new Set<SkillFile>()
  let profile: ProjectProfile | null = null

  pi.on('session_start', async (ctx: any) => {
    profile = await detectProjectProfile(process.cwd())

    const baseSkills = getBaseSkills(profile)
    const skillContents: string[] = []

    for (const skillFile of baseSkills) {
      const content = await readSkill(skillFile)
      if (content) {
        skillContents.push(`<skill name="${skillFile}">\n${content}\n</skill>`)
        loadedSkills.add(skillFile)
      }
    }

    if (skillContents.length > 0) {
      ctx.session.appendSystemText(skillContents.join('\n\n'))
    }
  })

  pi.on('input', async (ctx: any, message: string) => {
    if (!profile) return

    const newSkills = getMessageSkills(message, profile, loadedSkills)
    if (newSkills.length === 0) return

    const skillContents: string[] = []
    for (const skillFile of newSkills) {
      const content = await readSkill(skillFile)
      if (content) {
        skillContents.push(`<skill name="${skillFile}">\n${content}\n</skill>`)
        loadedSkills.add(skillFile)
      }
    }

    if (skillContents.length > 0) {
      ctx.session.appendSystemText(
        `[Skills loaded for this message: ${newSkills.join(', ')}]\n\n` +
        skillContents.join('\n\n')
      )
    }
  })
}