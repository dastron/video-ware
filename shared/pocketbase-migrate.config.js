export default {
  // PocketBase instance URL
  url: process.env.POCKETBASE_URL || 'http://localhost:8090',

  // Admin credentials for migrations
  admin: {
    email: process.env.POCKETBASE_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.POCKETBASE_ADMIN_PASSWORD || 'admin123456',
  },

  schema: {
    directory: './src/schema',
    exclude: ['*.test.ts', '*.spec.ts'],
  },
  migrations: {
    directory: '../pb/pb_migrations',
    format: 'js',
  },
};
