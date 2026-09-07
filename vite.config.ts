import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import type { ApiRequest, ApiResponse } from './src/server/types/http'

/**
 * Resolves a request path like "services/abc-123" to an API handler file,
 * mirroring Vercel's file-based routing: an exact match (api/services/abc-123.ts)
 * wins, otherwise a single-segment dynamic file in the same directory
 * (api/services/[id].ts) matches and its bracket name becomes a query param
 * — i.e. req.query.id === "abc-123", exactly like Vercel's own dynamic
 * routes. Only one dynamic segment, at the last path position, is
 * supported — that's all this project's routes need.
 */
function resolveApiFile(apiDir: string, routePath: string): { filePath: string; params: Record<string, string> } | null {
  const exact = path.join(apiDir, `${routePath}.ts`)
  if (fs.existsSync(exact)) {
    return { filePath: exact, params: {} }
  }

  const index = path.join(apiDir, routePath, 'index.ts')
  if (fs.existsSync(index)) {
    return { filePath: index, params: {} }
  }

  const segments = routePath.split('/')
  const last = segments.pop()
  if (last === undefined || last === '') return null

  const dir = path.join(apiDir, ...segments)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null

  for (const entry of fs.readdirSync(dir)) {
    const match = /^\[(.+)\]\.ts$/.exec(entry)
    if (match?.[1]) {
      return { filePath: path.join(dir, entry), params: { [match[1]]: last } }
    }
  }

  return null
}

/**
 * Local development emulation of Vercel serverless functions.
 *
 * In production, files under /api are deployed by Vercel as individual
 * serverless functions with the same (req, res) signature used here. This
 * plugin lets `vite dev` serve the exact same handler modules on the same
 * origin as the frontend, so there is a single `npm run dev` command and no
 * CORS configuration is needed. It is dev-only: `vite build` / `vite preview`
 * never touch this code path.
 */
function localApiPlugin(): Plugin {
  return {
    name: 'local-vercel-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          next()
          return
        }

        const url = new URL(req.url, 'http://localhost')
        const routePath = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '')
        const apiDir = path.resolve(server.config.root, 'api')
        const resolved = resolveApiFile(apiDir, routePath)

        if (!resolved) {
          next()
          return
        }
        const { filePath, params } = resolved

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk as Buffer)
          }
          const rawBody = Buffer.concat(chunks).toString('utf-8')

          let body: unknown = undefined
          if (rawBody) {
            try {
              body = JSON.parse(rawBody)
            } catch {
              body = rawBody
            }
          }

          const cookies: Record<string, string> = {}
          const cookieHeader = req.headers.cookie ?? ''
          for (const pair of cookieHeader.split(';')) {
            const idx = pair.indexOf('=')
            if (idx === -1) continue
            const key = pair.slice(0, idx).trim()
            const value = pair.slice(idx + 1).trim()
            if (key) {
              try {
                cookies[key] = decodeURIComponent(value)
              } catch {
                cookies[key] = value
              }
            }
          }

          const apiReq = req as unknown as ApiRequest
          apiReq.body = body
          apiReq.cookies = cookies
          apiReq.query = { ...Object.fromEntries(url.searchParams), ...params }

          const apiRes = res as unknown as ApiResponse
          apiRes.status = (code: number) => {
            res.statusCode = code
            return apiRes
          }
          apiRes.json = (data: unknown) => {
            if (!res.getHeader('Content-Type')) {
              res.setHeader('Content-Type', 'application/json')
            }
            res.end(JSON.stringify(data))
          }
          apiRes.send = (data: unknown) => {
            res.end(data as never)
          }

          const relativeId = '/' + path.relative(server.config.root, filePath).split(path.sep).join('/')
          const mod = await server.ssrLoadModule(relativeId)
          const handler = mod.default as (req: ApiRequest, res: ApiResponse) => void | Promise<void>

          if (typeof handler !== 'function') {
            next()
            return
          }

          await handler(apiReq, apiRes)
        } catch (err) {
          next(err as Error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  server: {
    port: 5173,
  },
})
