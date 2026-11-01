// Resolves the app's extensionless relative imports ('../data/fields') to .ts files, as Vite does,
// so `node --test` can load app modules that import other app modules
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || (error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})
