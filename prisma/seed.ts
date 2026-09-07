import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/server/auth/password'

const prisma = new PrismaClient()

const DEV_EMAIL = 'owner@example.com'
const DEV_PASSWORD = 'DevOnlyPassword123!' // development-only, never used in production

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the seed script in production')
  }

  const existing = await prisma.user.findUnique({ where: { email: DEV_EMAIL } })
  if (existing) {
    console.log('Seed data already exists, skipping.')
    return
  }

  const passwordHash = await hashPassword(DEV_PASSWORD)

  const tenant = await prisma.tenant.create({
    data: { name: 'Demo Auto Service', status: 'trial' },
  })

  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: DEV_EMAIL,
      passwordHash,
      name: 'Demo Owner',
      role: 'owner',
    },
  })

  await prisma.business.create({
    data: { tenantId: tenant.id, name: 'Demo Auto Service' },
  })

  console.log('Seed complete.')
  console.log(`Development-only login: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
