import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { PrismaNeon } from '@prisma/adapter-neon';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    adapter: async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error('DATABASE_URL is not set');
      }
      return new PrismaNeon({ connectionString });
    },
  },
});