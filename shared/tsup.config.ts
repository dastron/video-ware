import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    schema: 'src/schema.ts',
    enums: 'src/enums.ts',
    types: 'src/types.ts',
    mutator: 'src/mutator.ts',
    env: 'src/env.ts',
    'utils/time': 'src/utils/time.ts',
    'storage/index': 'src/storage/index.ts',
    'config/index': 'src/config/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  treeshake: true,
});
