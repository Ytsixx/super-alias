// index.d.ts
declare module 'enhanced-module-alias' {
  import { EventEmitter } from 'events'

  export interface ModuleAliasOptions {
    base?: string
    debug?: boolean
    hotReload?: boolean
  }

  export interface PerformanceStats {
    resolutions: number
    cacheHits: number
    aliasMatches: number
    cacheSize: number
    aliasCount: number
    pathCount: number
  }

  export interface LogData {
    timestamp: string
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
    [key: string]: any
  }

  export type AliasResolver = (fromPath: string, request: string, alias: string) => string

  export class ModuleAliasManager extends EventEmitter {
    modulePaths: string[]
    moduleAliases: Record<string, string | AliasResolver>
    moduleAliasNames: string[]
    debugMode: boolean

    constructor()

    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, any>): void
    
    isPathMatchesAlias(path: string, alias: string): boolean
    
    resolveAlias(request: string, parentModule?: NodeModule): string
    
    validateAliasTarget(target: string): boolean
    
    watchPackageJson(packageJsonPath: string): void
    
    reloadAliases(packageJsonPath: string): void
    
    addPath(path: string): void
    
    addAlias(alias: string, target: string | AliasResolver): void
    
    addAliases(aliases: Record<string, string | AliasResolver>): void
    
    resolveAsync(request: string, parentModule?: NodeModule): Promise<string>
    
    reset(): void
    
    init(options?: ModuleAliasOptions | string): void
    
    getStats(): PerformanceStats
    
    setDebugMode(enabled: boolean): void

    // Events
    on(event: 'log', callback: (data: LogData) => void): this
    on(event: 'aliasesReloaded', callback: (data: { aliases: Record<string, string | AliasResolver> }) => void): this
    on(event: 'pathAdded', callback: (data: { path: string }) => void): this
    on(event: 'aliasAdded', callback: (data: { alias: string, target: string | AliasResolver }) => void): this
    on(event: 'reset', callback: () => void): this
    on(event: 'initialized', callback: (data: { aliases: Record<string, string | AliasResolver>, paths: string[] }) => void): this
    on(event: string | symbol, listener: (...args: any[]) => void): this

    off(event: string | symbol, listener: (...args: any[]) => void): this
  }

  // Main initialization function
  function init(options?: ModuleAliasOptions | string): void

  // Enhanced API
  export function addPath(path: string): void
  export function addAlias(alias: string, target: string | AliasResolver): void
  export function addAliases(aliases: Record<string, string | AliasResolver>): void
  export function isPathMatchesAlias(path: string, alias: string): boolean
  export function reset(): void
  export function resolveAsync(request: string, parentModule?: NodeModule): Promise<string>
  export function getStats(): PerformanceStats
  export function setDebugMode(enabled: boolean): void
  export function on(event: string, callback: Function): void
  export function off(event: string, callback: Function): void

  // Manager instance access
  export const manager: ModuleAliasManager

  export = init
}