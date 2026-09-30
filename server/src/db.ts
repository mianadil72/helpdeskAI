import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (see server/.env.example)')
}

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})
