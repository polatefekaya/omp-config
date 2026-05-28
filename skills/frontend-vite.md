## Vite Conventions

Read frontend.md first. This covers Vite-specific patterns.

---

### Environment Variables
- Prefix: `VITE_` for client-accessible variables
- Access via `import.meta.env.VITE_X` — not `process.env`
- Server-only vars (no VITE_ prefix) are not exposed to the client bundle
- Environment checks:
```ts
  import.meta.env.DEV        // true in development
  import.meta.env.PROD       // true in production
  import.meta.env.MODE       // 'development' | 'production' | custom
```
- Validate at app startup with Zod:
```ts
  const envSchema = z.object({
    VITE_API_URL: z.string().url(),
    VITE_APP_ENV: z.enum(['development', 'staging', 'production']),
  })
  export const env = envSchema.parse(import.meta.env)
```
- `.env` files: `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`
  — read which ones exist in the project

---

### Path Aliases
- Aliases are defined in `vite.config.ts` — read it before using `@/` or similar:
```ts
  // vite.config.ts
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
    }
  }
```
- Also mirrored in `tsconfig.json` under `paths` — both must stay in sync
- Do not add new aliases without updating both files

---

### Config Structure
```ts
// vite.config.ts
export default defineConfig({
  plugins: [
    // Read existing plugins before adding new ones
  ],
  resolve: { alias: { ... } },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      }
    }
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  }
})
```

---

### Dev Proxy
- API calls to `/api/*` are typically proxied to the backend in dev
- Read `vite.config.ts` server.proxy before hardcoding API URLs
- Do not use full localhost URLs in application code — use relative paths
  that go through the proxy

---

### Static Assets
- Files in `public/` are served as-is — import them with absolute paths: `/logo.svg`
- Files in `src/assets/` are processed by Vite — import them as modules:
```ts
  import logoUrl from './assets/logo.svg'
```
- SVGs can be imported as React/Solid components if the plugin is configured:
```ts
  import Logo from './assets/logo.svg?component'  // read plugin config first
```

---

### Build
- `pnpm build` produces `dist/` — do not commit this
- `pnpm preview` serves the production build locally
- Check `package.json` scripts before running custom build commands

---

### What to verify after Vite config changes
1. Are new env variables added to both `.env.example` and the Zod schema?
2. If you added a path alias: is it in both `vite.config.ts` AND `tsconfig.json`?
3. Does the dev proxy still cover all API routes?
4. `tsc --noEmit` passes