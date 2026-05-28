## Frontend Base Conventions

These apply to every frontend project regardless of framework.
Framework-specific rules live in frontend-react.md, frontend-solid.md,
frontend-nextjs.md, frontend-vite.md. Read the relevant ones too.

---

### Package Manager
- pnpm only — never `npm install`, `yarn add`, or `bun add`
- `pnpm add [package]` to add, `pnpm remove [package]` to remove
- Check `package.json` before adding any dependency — it may already exist
- If a package already provides the functionality under a different name, use that
- Never add a package without reading what it actually does in context of this project
- Workspace packages use `pnpm` workspace protocol — do not change workspace references

---

### TypeScript
- `strict: true` is non-negotiable — treat every strict check as a hard error
- No `any` — if you are tempted, use `unknown` and narrow it properly
- No type assertions (`as SomeType`) without a comment explaining why it is safe
- `as unknown as T` is a code smell — stop and redesign if you reach for this
- Prefer `type` for data shapes, unions, intersections, mapped types
- Prefer `interface` only for things that are explicitly `implements`-d
- Use `satisfies` when you want type checking without losing inference:
```ts
  const config = {
    endpoint: '/api/orders',
    method: 'POST',
  } satisfies RequestConfig
```
- Discriminated unions over nullable booleans:
```ts
  // Wrong
  type AsyncState<T> = {
    loading: boolean
    error: string | null
    data: T | null
  }
  // Right
  type AsyncState<T> =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'success'; data: T }
```
- Read existing utility types in the project before inventing new ones
- `readonly` on arrays and object props that should not be mutated:
```ts
  type Order = { readonly id: string; readonly items: readonly OrderItem[] }
```

---

### Zod
- Zod schemas are the source of truth for all API response shapes
- Derive TypeScript types from schemas — never maintain parallel type definitions:
```ts
  export const orderSchema = z.object({
    id: z.string().uuid(),
    total: z.number().positive(),
    status: z.enum(['pending', 'confirmed', 'shipped']),
    createdAt: z.string().datetime(),
  })
  export type Order = z.infer<typeof orderSchema>
```
- Validate API responses at the boundary — do not trust backend shapes implicitly
- Read the existing schema file before adding a new schema — it likely exists

---

### Tailwind v4
- No `tailwind.config.js` — v4 is CSS-first configuration
- Custom design tokens are in the CSS entry file under `@theme`:
```css
  @import "tailwindcss";
  @theme {
    --color-brand-500: oklch(62% 0.19 250);
    --font-sans: 'Inter Variable', sans-serif;
    --spacing-18: 4.5rem;
  }
```
- Read the CSS entry file before adding any custom token — it likely already has it
- No `@apply` in component files — utilities go in markup only
- Dynamic classes must be complete strings — no string interpolation:
```ts
  // Wrong — Tailwind cannot scan this
  `bg-${color}-500`
  // Right
  const colorClass = { blue: 'bg-blue-500', red: 'bg-red-500' } as const
  colorClass[color]
```
- Class merging uses `clsx` + `tailwind-merge` if present — read existing
  pattern in the project before writing your own merge logic
- v4 handles CSS nesting natively — no PostCSS nesting plugin needed

---

### API Client and Error Handling
- Read CONTEXT.md for how this project calls the backend
  (generated OpenAPI client, custom fetch wrapper, or something else)
- Do not introduce a new HTTP calling pattern — use what exists
- Backend returns ProblemDetails (RFC 7807) for all errors — shape:
```ts
  type ProblemDetails = {
    type: string
    title: string
    status: number
    detail?: string
    instance?: string
    errors?: Record<string, string[]>  // validation errors
    traceId?: string
  }
```
- Handle ProblemDetails consistently — read how existing error handling
  works in this project before writing new error UI

---

### File and Folder Conventions
- Read the existing structure before creating new files
- Do not add barrel `index.ts` exports to folders that do not already have them
  — they cause circular dependency issues with bundlers
- Co-locate related files: `OrderCard.tsx`, `OrderCard.test.tsx`, `OrderCard.module.css`
  (if CSS modules are used — check the project)
- Shared components go in `components/` or `ui/` — read CONTEXT.md for the convention
- Feature-specific components stay inside the feature folder

---

### What to always verify after any frontend change
1. `tsc --noEmit` — run it, fix all errors before responding
2. If you changed a Tailwind class: confirm it is valid v4 syntax
3. If you added a dependency: confirm `pnpm add` was used
4. If you changed an API response shape: confirm the Zod schema was updated too
5. If you used string concatenation for class names: convert to lookup map