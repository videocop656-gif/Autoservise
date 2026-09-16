import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Prisma } from '@prisma/client'

// Prompt 44 — Lead vs CustomerRequest Domain Consolidation. `Lead` (the
// original, pre-Prompt-07 "customer inquiry" concept) has been retired:
// `CustomerRequest` is now the sole customer-intake entity in this product.
// These are regression tests, not feature tests — they exist only to catch
// a future accidental reintroduction of the retired model or its surface.
describe('Lead retirement (Prompt 44)', () => {
  it('the Prisma schema no longer exposes a Lead model or its enums', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name)
    expect(modelNames).not.toContain('Lead')

    const enumNames = Prisma.dmmf.datamodel.enums.map((e) => e.name)
    expect(enumNames).not.toContain('LeadStatus')
    expect(enumNames).not.toContain('LeadSource')
  })

  it('no Lead API route, service, repository, validation schema, or settings page remains on disk', () => {
    const root = path.resolve(__dirname, '..')
    const retiredPaths = [
      'api/leads',
      'src/server/services/leadService.ts',
      'src/server/repositories/leadRepository.ts',
      'src/server/validation/lead.schemas.ts',
      'src/pages/settings/LeadsSettingsPage.tsx',
    ]
    for (const relativePath of retiredPaths) {
      expect(existsSync(path.join(root, relativePath))).toBe(false)
    }
  })

  it('the old /settings/leads URL is not routed to a Leads page', () => {
    // App.tsx keeps the URL alive only as a redirect to /requests — read as
    // plain text so this test doesn't need a DOM/router harness.
    const appTsxPath = path.resolve(__dirname, '..', 'src', 'App.tsx')
    const appTsx = readFileSync(appTsxPath, 'utf8')

    expect(appTsx).not.toMatch(/LeadsSettingsPage/)
    expect(appTsx).toMatch(/path="\/settings\/leads"\s+element=\{<Navigate to="\/requests"/)
  })

  it('the Settings navigation no longer lists a Leads entry', () => {
    const navPath = path.resolve(__dirname, '..', 'src', 'components', 'layout', 'navigation.ts')
    const nav = readFileSync(navPath, 'utf8')

    expect(nav).not.toMatch(/\/settings\/leads/)
  })
})
