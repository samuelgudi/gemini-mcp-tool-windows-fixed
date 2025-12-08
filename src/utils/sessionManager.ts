import * as fs from 'fs';
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
 * Default session configurations per tool
 */
const DEFAULT_CONFIGS: Record<string, Partial<SessionConfig>> = {
  'review-code': {
    ttl: 24 * 60 * 60 * 1000, // 24 hours
    maxSessions: 20,
    evictionPolicy: 'fifo'
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

  constructor(toolName: string, customConfig?: Partial<SessionConfig>) {
    const defaultConfig = DEFAULT_CONFIGS[toolName] || {};

    this.config = {
      toolName,
      ttl: customConfig?.ttl ?? defaultConfig.ttl ?? 24 * 60 * 60 * 1000,
      maxSessions: customConfig?.maxSessions ?? defaultConfig.maxSessions ?? 20,
      evictionPolicy: customConfig?.evictionPolicy ?? defaultConfig.evictionPolicy ?? 'lru'
    };

    this.cacheDir = path.join(BASE_SESSIONS_DIR, toolName);
    this.ensureCacheDir();
  }

  /**
   * Ensures the tool's session directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      Logger.debug(`Created session directory: ${this.cacheDir}`);
    }
  }

  /**
   * Saves a session to persistent storage
   * @param sessionId User-provided or generated session ID
   * @param data Tool-specific session data
   */
  save(sessionId: string, data: T): void {
    this.ensureCacheDir();
    this.cleanExpiredSessions();

    const filePath = this.getSessionFilePath(sessionId);

    const cacheEntry: SessionCacheEntry<T> = {
      data: {
        ...data,
        sessionId,
        lastAccessedAt: Date.now()
      },
      timestamp: Date.now(),
      expiryTime: Date.now() + this.config.ttl
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(cacheEntry, null, 2));
      Logger.debug(`[${this.config.toolName}] Saved session: ${sessionId}`);
    } catch (error) {
      Logger.error(`Failed to save session ${sessionId}: ${error}`);
      throw new Error(`Failed to save session: ${error}`);
    }

    this.enforceSessionLimits();
  }

  /**
   * Loads a session from storage
   * @param sessionId The session ID to load
   * @returns Session data or null if not found/expired
   */
  load(sessionId: string): T | null {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      if (!fs.existsSync(filePath)) {
        Logger.debug(`[${this.config.toolName}] Session not found: ${sessionId}`);
        return null;
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const cacheEntry: SessionCacheEntry<T> = JSON.parse(fileContent);

      // Check expiry
      if (Date.now() > cacheEntry.expiryTime) {
        fs.unlinkSync(filePath);
        Logger.debug(`[${this.config.toolName}] Session expired and deleted: ${sessionId}`);
        return null;
      }

      // Update last accessed time for LRU
      if (this.config.evictionPolicy === 'lru') {
        cacheEntry.data.lastAccessedAt = Date.now();
        cacheEntry.timestamp = Date.now();
        fs.writeFileSync(filePath, JSON.stringify(cacheEntry, null, 2));
      }

      Logger.debug(`[${this.config.toolName}] Loaded session: ${sessionId}`);
      return cacheEntry.data;
    } catch (error) {
      Logger.error(`Failed to load session ${sessionId}: ${error}`);
      // Clean up corrupted file
      try {
        fs.unlinkSync(filePath);
      } catch {}
      return null;
    }
  }

  /**
   * Lists all active sessions for this tool
   * @returns Array of session data
   */
  list(): T[] {
    this.ensureCacheDir();
    const sessions: T[] = [];
    const now = Date.now();

    try {
      const files = fs.readdirSync(this.cacheDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        try {
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          const cacheEntry: SessionCacheEntry<T> = JSON.parse(fileContent);

          // Skip expired sessions
          if (now <= cacheEntry.expiryTime) {
            sessions.push(cacheEntry.data);
          }
        } catch (error) {
          Logger.debug(`Error reading session file ${file}: ${error}`);
        }
      }
    } catch (error) {
      Logger.error(`Failed to list sessions: ${error}`);
    }

    return sessions;
  }

  /**
   * Deletes a specific session
   * @param sessionId The session ID to delete
   * @returns true if deleted, false if not found
   */
  delete(sessionId: string): boolean {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        Logger.debug(`[${this.config.toolName}] Deleted session: ${sessionId}`);
        return true;
      }
      return false;
    } catch (error) {
      Logger.error(`Failed to delete session ${sessionId}: ${error}`);
      return false;
    }
  }

  /**
   * Cleans up expired sessions
   */
  private cleanExpiredSessions(): void {
    try {
      this.ensureCacheDir();
      const files = fs.readdirSync(this.cacheDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        try {
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          const cacheEntry: SessionCacheEntry<T> = JSON.parse(fileContent);

          if (now > cacheEntry.expiryTime) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch (error) {
          Logger.debug(`Error checking session file ${file}: ${error}`);
        }
      }

      if (cleaned > 0) {
        Logger.debug(`[${this.config.toolName}] Cleaned ${cleaned} expired sessions`);
      }
    } catch (error) {
      Logger.debug(`Session cleanup error: ${error}`);
    }
  }

  /**
   * Enforces maximum session limits using configured eviction policy
   */
  private enforceSessionLimits(): void {
    try {
      const files = fs
        .readdirSync(this.cacheDir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.cacheDir, f),
          stat: fs.statSync(path.join(this.cacheDir, f))
        }));

      if (files.length <= this.config.maxSessions) {
        return;
      }

      // Sort based on eviction policy
      if (this.config.evictionPolicy === 'fifo') {
        // Sort by creation time (oldest first)
        files.sort((a, b) => a.stat.birthtimeMs - b.stat.birthtimeMs);
      } else {
        // LRU: Sort by modification time (least recently accessed first)
        files.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
      }

      // Remove oldest files
      const toRemove = files.slice(0, files.length - this.config.maxSessions);
      for (const file of toRemove) {
        try {
          fs.unlinkSync(file.path);
        } catch {}
      }

      Logger.debug(
        `[${this.config.toolName}] Removed ${toRemove.length} sessions (${this.config.evictionPolicy} policy)`
      );
    } catch (error) {
      Logger.debug(`Error enforcing session limits: ${error}`);
    }
  }

  /**
   * Gets the file path for a session
   */
  private getSessionFilePath(sessionId: string): string {
    // Sanitize session ID for filesystem safety
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '-');
    return path.join(this.cacheDir, `${safeSessionId}.json`);
  }

  /**
   * Gets statistics about the session cache
   */
  getStats(): {
    toolName: string;
    sessionCount: number;
    ttl: number;
    maxSessions: number;
    evictionPolicy: string;
    cacheDir: string;
  } {
    this.ensureCacheDir();
    let sessionCount = 0;

    try {
      const files = fs.readdirSync(this.cacheDir);
      sessionCount = files.filter(f => f.endsWith('.json')).length;
    } catch {}

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
