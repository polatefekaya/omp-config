## Next.js Conventions

Read frontend.md and frontend-react.md first.
This covers Next.js App Router specific patterns.

---

### App Router — Default Mental Model
- Server Components are the default — everything is a Server Component unless
  you add `'use client'` at the top
- Server Components run on the server: they can access databases, environment
  variables, and file system directly — no `useEffect`, no `useState`
- Client Components run in the browser: they handle interactivity, events,
  browser APIs
- The boundary between them is `'use client'` — place it as deep as possible,
  not at the top of the tree

---

### When to Add `'use client'`
Only when you need:
- Event handlers (`onClick`, `onChange`, etc.)
- `useState`, `useReducer`, `useEffect`, `useContext`
- Browser APIs (`window`, `document`, `localStorage`)
- Third-party libraries that are client-only

Do NOT add `'use client'` just because a child component needs it —
only the component that actually uses client features needs the directive.

---

### Data Fetching Patterns

#### Server Component (preferred for initial data)
```tsx
// app/orders/page.tsx — Server Component, no 'use client'
export default async function OrdersPage() {
  const orders = await db.orders.findMany({ ... })  // direct DB access
  return <OrderList orders={orders} />
}
```

#### With fetch (external API)
```tsx
async function getOrder(id: string) {
  const res = await fetch(`${process.env.API_URL}/orders/${id}`, {
    next: { revalidate: 60 },  // ISR — revalidate every 60 seconds
    // or: next: { tags: ['orders'] }  for on-demand revalidation
  })
  if (!res.ok) throw new Error('Failed to fetch order')
  return orderSchema.parse(await res.json())
}
```

#### Client-side data (React Query in Client Components)
- Use React Query for data that changes frequently, needs polling,
  or requires client-side interaction
- Do not duplicate Server Component data fetching in React Query —
  choose one approach per piece of data

---

### Server Actions
- Use for mutations (forms, button actions) — not for data fetching
- Define in `actions.ts` or co-located with the component:
```ts
  'use server'
  
  export async function createOrderAction(formData: FormData) {
    const data = createOrderSchema.parse({
      productId: formData.get('productId'),
      quantity: Number(formData.get('quantity')),
    })
    
    await orderService.create(data)
    revalidateTag('orders')  // invalidate cached data
  }
```
- Always validate input with Zod in Server Actions — never trust FormData directly
- Return typed results, not thrown errors, for user-facing validation:
```ts
  type ActionResult =
    | { success: true; orderId: string }
    | { success: false; errors: Record<string, string[]> }
  
  export async function createOrderAction(
    prevState: ActionResult | null,
    formData: FormData
  ): Promise<ActionResult> { ... }
```

---

### Route Handlers
- For API endpoints consumed by external clients or mobile apps
- File: `app/api/[route]/route.ts`
- Use `NextRequest`/`NextResponse`:
```ts
  export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params
    const order = await getOrder(id)
    if (!order) return NextResponse.json(
      { title: 'Not Found', status: 404 },
      { status: 404 }
    )
    return NextResponse.json(order)
  }
```

---

### File Conventions
app/
layout.tsx          ← root layout, always present
page.tsx            ← route page
loading.tsx         ← Suspense boundary for the route
error.tsx           ← error boundary for the route ('use client')
not-found.tsx       ← 404 for this route segment
template.tsx        ← re-mounts on navigation (vs layout which persists)
(group)/            ← route group, does not affect URL
[param]/            ← dynamic segment
[...slug]/          ← catch-all
[[...slug]]/        ← optional catch-all

---

### Images, Links, Fonts
```tsx
// Always use next/image — never raw <img>
import Image from 'next/image'
<Image src="/hero.png" alt="Hero" width={1200} height={600} priority />

// Always use next/link for internal navigation — never raw <a>
import Link from 'next/link'
<Link href="/orders/123">View Order</Link>

// Fonts — use next/font
import { Inter } from 'next/font/google'
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
```

---

### Environment Variables
- `NEXT_PUBLIC_` prefix: accessible in both server and client code
- No prefix: server-only — accessing in client code throws at build time
- Never use `process.env.SECRET` in Client Components
- Validate env vars at startup with Zod:
```ts
  // env.ts (server-only)
  const envSchema = z.object({
    DATABASE_URL: z.string().url(),
    API_KEY: z.string().min(1),
  })
  export const env = envSchema.parse(process.env)
```

---

### Caching
- `fetch` with `next: { revalidate: N }` for ISR
- `fetch` with `next: { tags: ['tag'] }` for on-demand revalidation
- `revalidatePath('/orders')` or `revalidateTag('orders')` in Server Actions
- `unstable_cache` for caching non-fetch async functions
- Do not over-cache — read the existing caching strategy in CONTEXT.md

---

### Middleware
- Lives in `middleware.ts` at the root
- Runs on every request — keep it fast
- Only use for: auth redirects, locale detection, A/B testing headers
- Do not do DB queries in middleware

---

### What to verify after Next.js changes
1. Does any new Server Component use `useState`/`useEffect`? Remove them.
2. Does any new Client Component do server-only things (DB access)?
3. Are Server Actions validating input with Zod?
4. Are all images using `next/image` and all links using `next/link`?
5. Are environment variables accessed in the right context?
6. `tsc --noEmit` passes