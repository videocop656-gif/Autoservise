import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import type { ApiRequest, ApiResponse } from './src/server/types/http'

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
        const filePath = path.resolve(server.config.root, 'api', `${routePath}.ts`)

        if (!fs.existsSync(filePath)) {
          next()
          return
        }

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
          apiReq.query = Object.fromEntries(url.searchParams)

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
