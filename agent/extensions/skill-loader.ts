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
    keywords: ['code style', 'formatting', 'naming', 'convention', 'style guide', 'lint', 'prettier', 'clean code', 'refactor', 'readability', 'comment', 'prose', 'naming convention', 'code review', 'coding standard', 'code quality', 'stylecop', 'editorconfig', 'eslint', 'biome'],
  },
  'dotnet-patterns.md': {
    projectFiles: ['.csproj', '.sln'],
    keywords: ['handler', 'command', 'query', 'feature', 'slice', 'endpoint', 'minimal api', 'vertical slice', 'feature folder', 'mediator', 'mediatr', 'record', 'sealed', 'nullable', 'net10', 'dotnet', 'csharp', 'c#', 'source generator'],
  },
  'masstransit.md': {
    packageNames: ['MassTransit'],
    keywords: ['consumer', 'saga', 'publish', 'subscribe', 'message', 'bus', 'queue', 'outbox', 'masstransit', 'message contract', 'request response', 'topic', 'exchange', 'rabbitmq', 'azure service bus', 'asb', 'dead letter', 'fault', 'compensating'],
  },
  'efcore-postgresql.md': {
    packageNames: ['Microsoft.EntityFrameworkCore', 'Npgsql.EntityFrameworkCore.PostgreSQL'],
    keywords: ['entity', 'dbcontext', 'migration', 'relationship', 'table', 'column', 'owned', 'ef core', 'efcore', 'postgres', 'postgresql', 'npgsql', 'database', 'query', 'include', 'theninclude', 'asnotracking', 'savechanges', 'scoped', 'dbcontextfactory', 'snake case'],
  },
  'api-design.md': {
    projectFiles: ['.csproj'],
    keywords: ['endpoint', 'route', 'api', 'http', 'request', 'response', 'minimal api', 'mapget', 'mappost', 'route group', 'routegroup', 'produces', 'openapi', 'swagger', 'rest', 'json', 'status code', 'content type', 'accept', 'versioning', 'mapdelete', 'mapput', 'mappatch'],
  },
  'error-handling.md': {
    keywords: ['error', 'exception', 'problem', 'fault', 'catch', 'throw', 'problemdetails', '404', '400', '500', 'validation', 'domain error', 'result type', 'result pattern', 'try catch', 'problem details', 'ietf', 'rfc', 'status code', 'bad request', 'not found', 'conflict', 'internal server', 'unprocessable', '401', '403', '409', '422'],
  },
  'resilience.md': {
    packageNames: ['Polly', 'Microsoft.Extensions.Http.Resilience'],
    keywords: ['retry', 'circuit breaker', 'timeout', 'httpclient', 'resilience', 'polly', 'typed client', 'retry policy', 'fallback', 'bulkhead', 'rate limit', 'transient', 'http resilience', 'typed httpclient', 'httpclientfactory', 'socket', 'connection'],
  },
  'background-services.md': {
    keywords: ['background', 'worker', 'hosted service', 'hostedservice', 'backgroundservice', 'job', 'scheduled', 'cron', 'background service', 'ihostedservice', 'scope', 'scopefactory', 'graceful', 'cancellation', 'cancellationtoken', 'loop', 'timer', 'periodic', 'schedule', 'task'],
  },
  'observability.md': {
    packageNames: ['OpenTelemetry'],
    keywords: ['activity', 'trace', 'span', 'telemetry', 'otel', 'signoz', 'metric', 'logging', 'activitysource', 'opentelemetry', 'diagnostic', 'diagnostics', 'tracer', 'tracing', 'export', 'otlp', 'jaeger', 'zipkin', 'dashboard', 'alert', 'monitor', 'structured log'],
  },
  'contracts-safety.md': {
    keywords: ['contract', 'message type', 'nuget', 'shared library', 'package version', 'bump', 'shared contract', 'version', 'versioning', 'semver', 'breaking change', 'backward', 'compatibility', 'deprecate', 'package', 'nupkg', 'nuget package', 'publish', 'dll'],
  },
  'garnet-caching.md': {
    packageNames: ['StackExchange.Redis'],
    keywords: ['cache', 'caching', 'garnet', 'redis', 'ttl', 'invalidate', 'distributed cache', 'cache aside', 'stackexchange', 'cache hit', 'cache miss', 'eviction', 'expiration', 'sliding', 'absolute', 'idistributedcache', 'imemorycache', 'hybrid', 'stale'],
  },
  'performance.md': {
    keywords: ['slow', 'performance', 'n+1', 'optimize', 'fast', 'efficient', 'pagination', 'bulk', 'memory', 'allocation', 'throughput', 'eager load', 'lazy load', 'projection', 'select', 'toList', 'toArray', 'firstordefault', 'single', 'count', 'any', 'exists', 'index', 'query plan', 'explain', 'profiler', 'benchmark', 'hot path'],
  },
  'timezones.md': {
    keywords: ['timezone', 'datetime', 'dateonly', 'utc', 'offset', 'dst', 'datetimeoffset', 'local time', 'zone', 'time zone', 'timeonly', 'utcnow', 'iana', 'tzdb', 'nodatime', 'daylight', 'conversion', 'display', 'serialization', 'iso 8601'],
  },
  'frontend.md': {
    projectFiles: ['package.json'],
    keywords: ['tailwind', 'zod', 'pnpm', 'typescript', 'frontend', 'strict', 'type', 'interface', 'discriminated', 'union', 'nullable', 'boolean', 'any type', 'never', 'unknown', 'generics', 'utility type'],
  },
  'frontend-react.md': {
    packageNames: ['react'],
    keywords: ['react', 'hook', 'usestate', 'useeffect', 'usecontext', 'usereducer', 'usecallback', 'usememo', 'useref', 'usequery', 'usemutation', 'zustand', 'tanstack', 'react query', 'error boundary', 'suspense', 'memo', 'purecomponent', 'rerender', 're-render', 'jsx', 'tsx'],
  },
  'frontend-solid.md': {
    packageNames: ['solid-js'],
    keywords: ['solid', 'signal', 'createsignal', 'createeffect', 'creatememo', 'createresource', 'createstore', 'batch', 'untrack', 'oncleanup', 'onmount', 'splitprops', 'mergeprops', 'reactive', 'solidjs', 'solid-js'],
  },
  'frontend-nextjs.md': {
    packageNames: ['next'],
    keywords: ['next', 'nextjs', 'server component', 'app router', 'server action', 'route handler', 'use client', 'use server', 'next.js', 'middleware', 'layout', 'page', 'loading', 'error boundary', 'dynamic', 'revalidate', 'generateStaticParams', 'generateMetadata', 'ssr', 'ssg', 'isr', 'streaming'],
  },
  'frontend-vite.md': {
    packageNames: ['vite'],
    keywords: ['vite', 'import.meta', 'vite_', 'vite config', 'vitest', 'import.meta.env', 'vite.config', 'alias', 'resolve', 'plugin', 'hmr', 'dev server', 'build', 'rollup'],
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
  const skills: SkillFile[] = []

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

let registered = false

export default function(pi: any) {
  if (registered) return
  registered = true
  const loadedSkills = new Set<SkillFile>()
  let profile: ProjectProfile | null = null
  pi.on('session_start', async (_event: any, ctx: any) => {
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
      await pi.sendUserMessage(skillContents.join('\n\n'), { deliverAs: 'steer' })
    }
  })

  pi.on('message_end', async (event: any, _ctx: any) => {
    const msg = event?.message ?? event
    const raw = msg?.content ?? msg?.text ?? msg
    // content may be string or [{type:"text",text:"..."}]
    const message: string = Array.isArray(raw)
      ? raw.map((b: any) => b.text ?? b.content ?? '').join(' ')
      : typeof raw === 'string' ? raw : ''
   if (!profile || !message) return
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
      await pi.sendUserMessage(
        `[Skills loaded for this message: ${newSkills.join(', ')}]\n\n` +
        skillContents.join('\n\n'),
        { deliverAs: 'steer' }
      )
   }
 })
}