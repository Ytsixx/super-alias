'use strict'

const BuiltinModule = require('module')
const nodePath = require('path')
const fs = require('fs')
const { EventEmitter } = require('events')

// Guard against poorly mocked module constructors
const Module = module.constructor.length > 1
  ? module.constructor
  : BuiltinModule

// Enhanced state management
class ModuleAliasManager extends EventEmitter {
  constructor () {
    super()
    this.modulePaths = []
    this.moduleAliases = {}
    this.moduleAliasNames = []
    this.performanceCache = new Map()
    this.debugMode = process.env.MODULE_ALIAS_DEBUG === 'true'
    this.watchers = new Map()
    this.asyncResolvers = new Map()

    // Performance metrics
    this.stats = {
      resolutions: 0,
      cacheHits: 0,
      aliasMatches: 0
    }

    this.setupHooks()
  }

  // Enhanced logging system
  log (level, message, data = {}) {
    if (!this.debugMode && level !== 'error') return

    const timestamp = new Date().toISOString()
    const logData = { timestamp, level, message, ...data }

    if (level === 'error') {
      console.error('[module-alias:ERROR]', message, data)
    } else if (this.debugMode) {
      console.log(`[module-alias:${level.toUpperCase()}]`, message, data)
    }

    this.emit('log', logData)
  }

  // Performance optimization with caching
  getCachedResolution (key) {
    const cached = this.performanceCache.get(key)
    if (cached && Date.now() - cached.timestamp < 5000) { // 5s cache
      this.stats.cacheHits++
      return cached.value
    }
    return null
  }

  setCachedResolution (key, value) {
    this.performanceCache.set(key, {
      value,
      timestamp: Date.now()
    })

    // Limit cache size
    if (this.performanceCache.size > 1000) {
      const firstKey = this.performanceCache.keys().next().value
      this.performanceCache.delete(firstKey)
    }
  }

  // Enhanced path matching with better performance
  isPathMatchesAlias (path, alias) {
    const cacheKey = `${path}:${alias}`
    const cached = this.getCachedResolution(cacheKey)
    if (cached !== null) return cached

    let matches = false

    // Exact match or starts with alias followed by separator
    if (path.indexOf(alias) === 0) {
      if (path.length === alias.length) {
        matches = true
      } else if (path[alias.length] === '/' || path[alias.length] === '\\') {
        matches = true
      }
    }

    this.setCachedResolution(cacheKey, matches)
    return matches
  }

  // Enhanced alias resolution with validation
  resolveAlias (request, parentModule) {
    this.stats.resolutions++

    // Try cache first
    const cacheKey = `resolve:${request}:${(parentModule && parentModule.filename) || 'unknown'}`
    const cached = this.getCachedResolution(cacheKey)
    if (cached !== null) return cached

    let resolvedRequest = request

    // Sort aliases by length (longer first) for better matching
    const sortedAliases = this.moduleAliasNames.slice().sort((a, b) => b.length - a.length)

    for (const alias of sortedAliases) {
      if (this.isPathMatchesAlias(request, alias)) {
        this.stats.aliasMatches++
        let aliasTarget = this.moduleAliases[alias]

        // Handle custom function resolvers
        if (typeof aliasTarget === 'function') {
          const fromPath = (parentModule && parentModule.filename) || process.cwd()

          try {
            aliasTarget = aliasTarget(fromPath, request, alias)
            if (!aliasTarget || typeof aliasTarget !== 'string') {
              throw new Error(`Custom handler function for alias '${alias}' must return a valid path string`)
            }
          } catch (error) {
            this.log('error', 'Custom alias resolver failed', { alias, error: error.message })
            throw error
          }
        }

        // Validate alias target exists
        if (!this.validateAliasTarget(aliasTarget)) {
          this.log('warn', 'Alias target does not exist', { alias, target: aliasTarget })
        }

        resolvedRequest = nodePath.join(aliasTarget, request.substr(alias.length))
        this.log('debug', 'Alias resolved', {
          original: request,
          alias,
          target: aliasTarget,
          resolved: resolvedRequest
        })
        break
      }
    }

    this.setCachedResolution(cacheKey, resolvedRequest)
    return resolvedRequest
  }

  // Validation helper
  validateAliasTarget (target) {
    if (!target || typeof target !== 'string') return false

    try {
      // Check if path exists (sync for performance, but could be made async)
      return fs.existsSync(target)
    } catch (err) {
      return false
    }
  }

  // Hot reload functionality
  watchPackageJson (packageJsonPath) {
    if (this.watchers.has(packageJsonPath)) return

    try {
      const watcher = fs.watch(packageJsonPath, (eventType) => {
        if (eventType === 'change') {
          this.log('info', 'package.json changed, reloading aliases', { path: packageJsonPath })
          this.reloadAliases(packageJsonPath)
        }
      })

      this.watchers.set(packageJsonPath, watcher)
      this.log('debug', 'Watching package.json for changes', { path: packageJsonPath })
    } catch (error) {
      this.log('error', 'Failed to watch package.json', { path: packageJsonPath, error: error.message })
    }
  }

  // Reload aliases from package.json
  reloadAliases (packageJsonPath) {
    try {
      // Clear require cache for package.json
      delete require.cache[require.resolve(packageJsonPath)]

      const packageJson = require(packageJsonPath)
      const base = nodePath.dirname(packageJsonPath)

      // Clear existing aliases
      this.moduleAliases = {}
      this.moduleAliasNames = []
      this.performanceCache.clear()

      // Reload aliases
      const aliases = packageJson._moduleAliases || {}
      for (const alias in aliases) {
        let target = aliases[alias]
        if (target[0] !== '/') {
          target = nodePath.join(base, target)
        }
        this.addAlias(alias, target)
      }

      this.emit('aliasesReloaded', { aliases: this.moduleAliases })
      this.log('info', 'Aliases reloaded successfully', { count: this.moduleAliasNames.length })
    } catch (error) {
      this.log('error', 'Failed to reload aliases', { error: error.message })
    }
  }

  // Setup Node.js hooks
  setupHooks () {
    this.oldNodeModulePaths = Module._nodeModulePaths
    this.oldResolveFilename = Module._resolveFilename

    const self = this

    Module._nodeModulePaths = function (from) {
      const paths = self.oldNodeModulePaths.call(this, from)

      // Only include the module path for top-level modules
      if (from.indexOf('node_modules') === -1) {
        return self.modulePaths.concat(paths)
      }

      return paths
    }

    Module._resolveFilename = function (request, parentModule, isMain, options) {
      try {
        const resolvedRequest = self.resolveAlias(request, parentModule)
        return self.oldResolveFilename.call(this, resolvedRequest, parentModule, isMain, options)
      } catch (error) {
        self.log('error', 'Module resolution failed', {
          request,
          parent: parentModule && parentModule.filename,
          error: error.message
        })
        throw error
      }
    }

    this.log('debug', 'Module hooks installed')
  }

  // Enhanced path management
  addPath (path) {
    path = nodePath.normalize(path)

    // Validation
    if (!path || typeof path !== 'string') {
      throw new TypeError('Path must be a non-empty string')
    }

    if (!fs.existsSync(path)) {
      this.log('warn', 'Adding non-existent path', { path })
    }

    if (this.modulePaths.indexOf(path) === -1) {
      this.modulePaths.push(path)
      this.log('debug', 'Path added', { path })

      // Enable the search path for the current top-level module
      const mainModule = this.getMainModule()
      if (mainModule) {
        this.addPathHelper(path, mainModule.paths)
      }

      let parent = module.parent
      while (parent && parent !== mainModule) {
        this.addPathHelper(path, parent.paths)
        parent = parent.parent
      }

      this.emit('pathAdded', { path })
    }
  }

  // Enhanced alias management
  addAlias (alias, target) {
    // Input validation
    if (!alias || typeof alias !== 'string') {
      throw new TypeError('Alias must be a non-empty string')
    }

    if (!target || (typeof target !== 'string' && typeof target !== 'function')) {
      throw new TypeError('Target must be a non-empty string or function')
    }

    // Normalize paths
    if (typeof target === 'string') {
      target = nodePath.normalize(target)
    }

    this.moduleAliases[alias] = target
    this.moduleAliasNames = Object.keys(this.moduleAliases)

    // Clear performance cache when aliases change
    this.performanceCache.clear()

    this.log('debug', 'Alias added', { alias, target })
    this.emit('aliasAdded', { alias, target })
  }

  addAliases (aliases) {
    if (!aliases || typeof aliases !== 'object') {
      throw new TypeError('Aliases must be an object')
    }

    for (const alias in aliases) {
      this.addAlias(alias, aliases[alias])
    }
  }

  // Async resolver support
  async resolveAsync (request, parentModule) {
    return new Promise((resolve, reject) => {
      try {
        const result = this.resolveAlias(request, parentModule)
        resolve(result)
      } catch (error) {
        reject(error)
      }
    })
  }

  // Helper methods
  addPathHelper (path, targetArray) {
    path = nodePath.normalize(path)
    if (targetArray && targetArray.indexOf(path) === -1) {
      targetArray.unshift(path)
    }
  }

  removePathHelper (path, targetArray) {
    if (targetArray) {
      const index = targetArray.indexOf(path)
      if (index !== -1) {
        targetArray.splice(index, 1)
      }
    }
  }

  getMainModule () {
    const main = require.main
    if (main && main._simulateRepl) return undefined
    return main
  }

  // Enhanced reset with cleanup
  reset () {
    this.log('debug', 'Resetting module alias manager')

    const mainModule = this.getMainModule()

    // Reset all changes in paths
    this.modulePaths.forEach(path => {
      if (mainModule) {
        this.removePathHelper(path, mainModule.paths)
      }

      // Clear require cache
      Object.getOwnPropertyNames(require.cache).forEach(name => {
        if (name.indexOf(path) !== -1) {
          delete require.cache[name]
        }
      })

      let parent = module.parent
      while (parent && parent !== mainModule) {
        this.removePathHelper(path, parent.paths)
        parent = parent.parent
      }
    })

    // Stop all watchers
    this.watchers.forEach(watcher => watcher.close())
    this.watchers.clear()

    // Clear all state
    this.modulePaths = []
    this.moduleAliases = {}
    this.moduleAliasNames = []
    this.performanceCache.clear()
    this.asyncResolvers.clear()

    // Reset stats
    this.stats = {
      resolutions: 0,
      cacheHits: 0,
      aliasMatches: 0
    }

    this.emit('reset')
    this.log('info', 'Module alias manager reset complete')
  }

  // Enhanced init with better error handling and features
  init (options = {}) {
    if (typeof options === 'string') {
      options = { base: options }
    }

    // Set debug mode from options
    if (options.debug !== undefined) {
      this.debugMode = options.debug
    }

    let candidatePackagePaths
    if (options.base) {
      candidatePackagePaths = [nodePath.resolve(options.base.replace(/\/package\.json$/, ''))]
    } else {
      candidatePackagePaths = [
        nodePath.join(__dirname, '../..'),
        process.cwd(),
        // Additional common locations
        nodePath.join(process.cwd(), 'src'),
        nodePath.dirname((require.main && require.main.filename) || process.cwd())
      ]
    }

    let npmPackage
    let base
    let packageJsonPath

    for (const candidatePath of candidatePackagePaths) {
      try {
        base = candidatePath
        packageJsonPath = nodePath.join(base, 'package.json')
        npmPackage = require(packageJsonPath)
        break
      } catch (e) {
        this.log('debug', 'Package.json not found', { path: packageJsonPath, error: e.message })
      }
    }

    if (typeof npmPackage !== 'object') {
      const pathString = candidatePackagePaths.join(',\n')
      const error = new Error(`Unable to find package.json in any of:\n[${pathString}]`)
      this.log('error', 'Package.json not found', { candidatePaths: candidatePackagePaths })
      throw error
    }

    this.log('info', 'Found package.json', { path: packageJsonPath })

    // Setup hot reload if enabled
    if (options.hotReload !== false) {
      this.watchPackageJson(packageJsonPath)
    }

    // Import aliases with validation
    const aliases = npmPackage._moduleAliases || {}
    const processedAliases = {}

    for (const alias in aliases) {
      let target = aliases[alias]
      if (target[0] !== '/') {
        target = nodePath.join(base, target)
      }
      processedAliases[alias] = target
    }

    this.addAliases(processedAliases)

    // Register custom module directories
    if (Array.isArray(npmPackage._moduleDirectories)) {
      npmPackage._moduleDirectories.forEach(dir => {
        if (dir === 'node_modules') return

        const modulePath = nodePath.join(base, dir)
        this.addPath(modulePath)
      })
    }

    this.log('info', 'Module alias manager initialized', {
      aliasCount: this.moduleAliasNames.length,
      pathCount: this.modulePaths.length,
      hotReload: options.hotReload !== false
    })

    this.emit('initialized', {
      aliases: this.moduleAliases,
      paths: this.modulePaths
    })
  }

  // Get performance statistics
  getStats () {
    return {
      ...this.stats,
      cacheSize: this.performanceCache.size,
      aliasCount: this.moduleAliasNames.length,
      pathCount: this.modulePaths.length
    }
  }

  // Enable/disable debug mode
  setDebugMode (enabled) {
    this.debugMode = enabled
    this.log('info', `Debug mode ${enabled ? 'enabled' : 'disabled'}`)
  }
}

// Create singleton instance
const manager = new ModuleAliasManager()

// Export enhanced API
module.exports = function init (options) {
  return manager.init(options)
}

// Enhanced exports
module.exports.addPath = (path) => manager.addPath(path)
module.exports.addAlias = (alias, target) => manager.addAlias(alias, target)
module.exports.addAliases = (aliases) => manager.addAliases(aliases)
module.exports.isPathMatchesAlias = (path, alias) => manager.isPathMatchesAlias(path, alias)
module.exports.reset = () => manager.reset()

// New enhanced exports
module.exports.resolveAsync = (request, parentModule) => manager.resolveAsync(request, parentModule)
module.exports.getStats = () => manager.getStats()
module.exports.setDebugMode = (enabled) => manager.setDebugMode(enabled)
module.exports.on = (event, callback) => manager.on(event, callback)
module.exports.off = (event, callback) => manager.off(event, callback)
module.exports.manager = manager

// TypeScript support
module.exports.ModuleAliasManager = ModuleAliasManager
