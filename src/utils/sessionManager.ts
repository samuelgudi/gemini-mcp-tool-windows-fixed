import * as fs from 'fs/promises';
import { existsSync, constants as fsConstants } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger.js';

/**
 * Base interface that all tool-specific session data must extend
 * Ensures every session has core metadata fields
 */
export interface SessionData {
  sessionId: string;
  createdAt: number;
  lastAccessedAt: number;
}

/**
 * Internal cache entry wrapper with expiry metadata
 */
interface SessionCacheEntry<T extends SessionData> {
  data: T;
  timestamp: number;
  expiryTime: number;
}

/**
 * Configuration for a tool's session management
 */
export interface SessionConfig {
  toolName: string;
  ttl: number; // Time to live in milliseconds
  maxSessions: number; // Maximum number of sessions before eviction
  evictionPolicy: 'fifo' | 'lru'; // First-In-First-Out or Least-Recently-Used
}

/**
 * Default session configuration for all tools
 */
const DEFAULT_SESSION_CONFIG: Omit<SessionConfig, 'toolName'> = {
  ttl: 24 * 60 * 60 * 1000, // 24 hours default
  maxSessions: 20, // 20 sessions default
  evictionPolicy: 'lru' // LRU default
};

/**
 * Default session configurations per tool
 */
const DEFAULT_CONFIGS: Record<string, Partial<SessionConfig>> = {
  'review-code': {
    ttl: 24 * 60 * 60 * 1000, // 24 hours
    maxSessions: 20,
    evictionPolicy: 'lru' // Changed from 'fifo' to 'lru' for consistency
  },
  'ask-gemini': {
    ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
    maxSessions: 50,
    evictionPolicy: 'lru'
  },
  'brainstorm': {
    ttl: 14 * 24 * 60 * 60 * 1000, // 14 days
    maxSessions: 30,
    evictionPolicy: 'lru'
  }
};

// Base session storage directory
const BASE_SESSIONS_DIR = path.join(os.homedir(), '.gemini-mcp', 'sessions');

/**
 * Generic session manager for all MCP tools
 * Type parameter T ensures type safety for tool-specific session data
 *
 * @example
 * ```typescript
 * const manager = new SessionManager<MySessionData>('my-tool');
 * manager.save('session-1', { sessionId: 'session-1', ... });
 * const session = manager.load('session-1');
 * ```
 */
export class SessionManager<T extends SessionData> {
  private config: SessionConfig;
  private cacheDir: string;
  private initPromise: Promise<void> | null = null;

  constructor(toolName: string, customConfig?: Partial<SessionConfig>) {
    const defaultConfig = DEFAULT_CONFIGS[toolName] || {};

    this.config = {
      toolName,
      ttl: customConfig?.ttl ?? defaultConfig.ttl ?? DEFAULT_SESSION_CONFIG.ttl,
      maxSessions: customConfig?.maxSessions ?? defaultConfig.maxSessions ?? DEFAULT_SESSION_CONFIG.maxSessions,
      evictionPolicy: customConfig?.evictionPolicy ?? defaultConfig.evictionPolicy ?? DEFAULT_SESSION_CONFIG.evictionPolicy
    };

    this.cacheDir = path.join(BASE_SESSIONS_DIR, toolName);
  }

  /**
   * Ensures the tool's session directory exists (lazy initialization)
   */
  private async ensureCacheDirAsync(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        if (!existsSync(this.cacheDir)) {
          await fs.mkdir(this.cacheDir, { recursive: true });
          Logger.debug(`[${this.config.toolName}] Created session directory: ${this.cacheDir}`);
        }
      } catch (error) {
        Logger.error(`[${this.config.toolName}] Failed to create session directory ${this.cacheDir}: ${error}`);
        throw new Error(`Session directory initialization failed: ${error}`);
      }
    })();

    return this.initPromise;
  }

  /**
   * Helper method to quickly get session count without parsing files
   */
  private async getSessionCountFast(): Promise<number> {
    try {
      const files = await fs.readdir(this.cacheDir);
      return files.filter(f => f.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  /**
   * Helper method to read and parse a session file
   */
  private async readSessionFile<U extends SessionData>(filePath: string): Promise<SessionCacheEntry<U>> {
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(fileContent);
    } catch (error) {
      throw new Error(`Failed to read session file: ${error}`);
    }
  }

  /**
   * Saves a session to persistent storage
   * @param sessionId User-provided or generated session ID
   * @param data Tool-specific session data
   */
  async save(sessionId: string, data: T): Promise<void> {
    await this.ensureCacheDirAsync();

    // Moderate cleanup: only at 80% threshold
    const sessionCount = await this.getSessionCountFast();
    if (sessionCount >= this.config.maxSessions * 0.8) {
      await this.cleanExpiredSessions();
    }

    const filePath = this.getSessionFilePath(sessionId);

    // Ensure createdAt is always set (Issue #4)
    const now = Date.now();
    const cacheEntry: SessionCacheEntry<T> = {
      data: {
        ...data,
        sessionId,
        createdAt: data.createdAt || now, // Fallback if not set
        lastAccessedAt: now
      },
      timestamp: now,
      expiryTime: now + this.config.ttl
    };

    try {
      await fs.writeFile(filePath, JSON.stringify(cacheEntry, null, 2), 'utf-8');
      Logger.debug(`[${this.config.toolName}] Saved session: ${sessionId}`);
    } catch (error) {
      Logger.error(`[${this.config.toolName}] Failed to save session ${sessionId}: ${error}`);
      throw new Error(`Failed to save session ${sessionId}: ${error}`);
    }

    // Only enforce limits if over max
    if (sessionCount >= this.config.maxSessions) {
      await this.enforceSessionLimits();
    }
  }

  /**
   * Loads a session from storage
   * @param sessionId The session ID to load
   * @returns Session data or null if not found/expired
   */
  async load(sessionId: string): Promise<T | null> {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      // Check if file exists asynchronously
      try {
        await fs.access(filePath, fsConstants.F_OK);
      } catch {
        Logger.debug(`[${this.config.toolName}] Session not found: ${sessionId}`);
        return null;
      }

      const cacheEntry = await this.readSessionFile<T>(filePath);

      // Check expiry
      if (Date.now() > cacheEntry.expiryTime) {
        await fs.unlink(filePath);
        Logger.debug(`[${this.config.toolName}] Session expired and deleted: ${sessionId}`);

        // Moderate optimization: run cleanup when we find expired sessions
        await this.cleanExpiredSessions();
        return null;
      }

      // Update last accessed time for LRU
      if (this.config.evictionPolicy === 'lru') {
        cacheEntry.data.lastAccessedAt = Date.now();
        cacheEntry.timestamp = Date.now();
        await fs.writeFile(filePath, JSON.stringify(cacheEntry, null, 2), 'utf-8');
      }

      Logger.debug(`[${this.config.toolName}] Loaded session: ${sessionId}`);
      return cacheEntry.data;
    } catch (error) {
      Logger.warn(`[${this.config.toolName}] Failed to load session ${sessionId}: ${error}`);

      // Issue #13: Only delete if file exists and is corrupt (not transient errors)
      try {
        await fs.access(filePath, fsConstants.F_OK);
        // File exists, try to delete it
        try {
          await fs.unlink(filePath);
          Logger.debug(`[${this.config.toolName}] Removed corrupt session file: ${sessionId}`);
        } catch (unlinkError) {
          Logger.debug(`[${this.config.toolName}] Could not remove corrupt file ${sessionId}: ${unlinkError}`);
        }
      } catch {
        // File doesn't exist, nothing to clean up
      }
      return null;
    }
  }

  /**
   * Lists all active sessions for this tool
   * @returns Array of session data
   */
  async list(): Promise<T[]> {
    await this.ensureCacheDirAsync();
    const sessions: T[] = [];
    const now = Date.now();

    try {
      const files = await fs.readdir(this.cacheDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        try {
          const cacheEntry = await this.readSessionFile<T>(filePath);

          // Skip expired sessions
          if (now <= cacheEntry.expiryTime) {
            sessions.push(cacheEntry.data);
          }
        } catch (error) {
          Logger.debug(`[${this.config.toolName}] Error reading session file ${file}: ${error}`);
        }
      }
    } catch (error) {
      Logger.error(`[${this.config.toolName}] Failed to list sessions: ${error}`);
    }

    return sessions;
  }

  /**
   * Deletes a specific session
   * @param sessionId The session ID to delete
   * @returns true if deleted, false if not found
   */
  async delete(sessionId: string): Promise<boolean> {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      await fs.unlink(filePath);
      Logger.debug(`[${this.config.toolName}] Deleted session: ${sessionId}`);
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        Logger.debug(`[${this.config.toolName}] Session not found for deletion: ${sessionId}`);
        return false; // File doesn't exist, effectively "deleted"
      }
      Logger.error(`[${this.config.toolName}] Failed to delete session ${sessionId}: ${error}`);
      return false;
    }
  }

  /**
   * Cleans up expired sessions
   */
  private async cleanExpiredSessions(): Promise<void> {
    try {
      await this.ensureCacheDirAsync();
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        try {
          const cacheEntry = await this.readSessionFile<T>(filePath);

          if (now > cacheEntry.expiryTime) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch (error) {
          // Issue #3: Log errors instead of empty catch
          Logger.debug(`[${this.config.toolName}] Error checking session file ${file}: ${error}`);

          // Try to remove corrupt file
          try {
            await fs.unlink(filePath);
            cleaned++;
          } catch (unlinkError) {
            Logger.debug(`[${this.config.toolName}] Could not remove corrupt file ${file}: ${unlinkError}`);
          }
        }
      }

      if (cleaned > 0) {
        Logger.debug(`[${this.config.toolName}] Cleaned ${cleaned} expired sessions`);
      }
    } catch (error) {
      Logger.debug(`[${this.config.toolName}] Session cleanup error: ${error}`);
    }
  }

  /**
   * Enforces maximum session limits using configured eviction policy
   */
  private async enforceSessionLimits(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      if (jsonFiles.length <= this.config.maxSessions) {
        return;
      }

      // Get file stats for sorting
      const fileStats = await Promise.all(
        jsonFiles.map(async (name) => {
          const filePath = path.join(this.cacheDir, name);
          const stat = await fs.stat(filePath);
          return { name, path: filePath, stat };
        })
      );

      // Sort based on eviction policy
      if (this.config.evictionPolicy === 'fifo') {
        // Sort by creation time (oldest first)
        fileStats.sort((a, b) => a.stat.birthtimeMs - b.stat.birthtimeMs);
      } else {
        // LRU: Sort by modification time (least recently accessed first)
        fileStats.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
      }

      // Remove oldest files
      const toRemove = fileStats.slice(0, fileStats.length - this.config.maxSessions);
      let removed = 0;

      for (const file of toRemove) {
        try {
          await fs.unlink(file.path);
          removed++;
        } catch (error) {
          // Issue #3: Log instead of empty catch
          Logger.debug(`[${this.config.toolName}] Failed to remove session file ${file.name}: ${error}`);
        }
      }

      Logger.debug(
        `[${this.config.toolName}] Removed ${removed}/${toRemove.length} sessions (${this.config.evictionPolicy} policy)`
      );
    } catch (error) {
      Logger.debug(`[${this.config.toolName}] Error enforcing session limits: ${error}`);
    }
  }

  /**
   * Gets the file path for a session
   */
  private getSessionFilePath(sessionId: string): string {
    // Issue #12: More robust sanitization
    // Replace invalid characters, then clean up consecutive/leading/trailing hyphens
    let safeSessionId = sessionId
      .replace(/[^a-zA-Z0-9-_]/g, '-')  // Replace invalid chars
      .replace(/-+/g, '-')                // Collapse consecutive hyphens
      .replace(/^-+|-+$/g, '');           // Remove leading/trailing hyphens

    // Ensure we have a valid ID after sanitization
    if (!safeSessionId) {
      safeSessionId = 'session';
    }

    return path.join(this.cacheDir, `${safeSessionId}.json`);
  }

  /**
   * Gets statistics about the session cache
   */
  async getStats(): Promise<{
    toolName: string;
    sessionCount: number;
    ttl: number;
    maxSessions: number;
    evictionPolicy: string;
    cacheDir: string;
  }> {
    await this.ensureCacheDirAsync();
    let sessionCount = 0;

    try {
      const files = await fs.readdir(this.cacheDir);
      sessionCount = files.filter(f => f.endsWith('.json')).length;
    } catch (error) {
      // Issue #9/#14: Log error instead of empty catch
      Logger.debug(`[${this.config.toolName}] Error reading session directory for stats: ${error}`);
    }

    return {
      toolName: this.config.toolName,
      sessionCount,
      ttl: this.config.ttl,
      maxSessions: this.config.maxSessions,
      evictionPolicy: this.config.evictionPolicy,
      cacheDir: this.cacheDir
    };
  }
}
