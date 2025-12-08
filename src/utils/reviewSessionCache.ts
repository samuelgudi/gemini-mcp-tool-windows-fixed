/**
 * @deprecated This file is deprecated. Session management has been migrated to the shared infrastructure.
 *
 * - For session operations, use: src/utils/reviewSessionManager.ts
 * - For type definitions, use: src/utils/sessionSchemas.ts
 *
 * This file is kept only for backward compatibility and type exports (ReviewComment, ReviewRound).
 * The actual session cache functions (save/load/create) have been moved to reviewSessionManager.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger.js';
import { GitState } from './gitStateDetector.js';

export interface ReviewComment {
  id: string;
  filePattern: string;
  lineRange?: { start: number; end: number };
  severity: 'critical' | 'important' | 'suggestion' | 'question';
  comment: string;
  roundGenerated: number;
  status: 'pending' | 'accepted' | 'rejected' | 'modified' | 'deferred';
  resolution?: string;
}

export interface ReviewRound {
  roundNumber: number;
  timestamp: number;
  filesReviewed: string[];
  userPrompt: string;
  geminiResponse: string;
  commentsGenerated: ReviewComment[];
  gitState: GitState;
}

export interface CodeReviewSession {
  sessionId: string;
  createdAt: number;
  lastAccessedAt: number;
  gitState: GitState; // initial git state
  currentGitState: GitState; // updated each round
  rounds: ReviewRound[];
  allComments: ReviewComment[];
  filesTracked: string[]; // Changed from Set to array for JSON serialization
  focusFiles?: string[];
  reviewScope?: 'full' | 'changes-only' | 'focused';
  totalRounds: number;
  sessionState: 'active' | 'paused' | 'completed';
}

interface ReviewSessionCacheEntry {
  session: CodeReviewSession;
  timestamp: number;
  expiryTime: number;
}

// Use persistent storage in user's home directory instead of tmp for session persistence across reboots
const REVIEW_CACHE_DIR = path.join(os.homedir(), '.gemini-mcp', 'review-sessions');
const REVIEW_SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours (increased from 60 min for better persistence)
const MAX_REVIEW_SESSIONS = 20;

/**
 * Ensures the review cache directory exists
 */
function ensureCacheDir(): void {
  if (!fs.existsSync(REVIEW_CACHE_DIR)) {
    fs.mkdirSync(REVIEW_CACHE_DIR, { recursive: true });
    Logger.debug(`Created review cache directory: ${REVIEW_CACHE_DIR}`);
  }
}

/**
 * Saves a review session to the cache
 * @param session The session to save
 */
export function saveReviewSession(session: CodeReviewSession): void {
  ensureCacheDir();
  cleanExpiredSessions();

  const filePath = path.join(REVIEW_CACHE_DIR, `${session.sessionId}.json`);

  const cacheEntry: ReviewSessionCacheEntry = {
    session,
    timestamp: Date.now(),
    expiryTime: Date.now() + REVIEW_SESSION_TTL
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(cacheEntry, null, 2));
    Logger.debug(`Saved review session: ${session.sessionId} (${session.totalRounds} rounds)`);
  } catch (error) {
    Logger.error(`Failed to save review session: ${error}`);
    throw new Error(`Failed to save review session: ${error}`);
  }

  enforceSessionLimits();
}

/**
 * Loads a review session from the cache
 * @param sessionId The session ID to load
 * @returns The session or null if not found/expired
 */
export function loadReviewSession(sessionId: string): CodeReviewSession | null {
  const filePath = path.join(REVIEW_CACHE_DIR, `${sessionId}.json`);

  try {
    if (!fs.existsSync(filePath)) {
      Logger.debug(`Session not found: ${sessionId}`);
      return null;
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const cacheEntry: ReviewSessionCacheEntry = JSON.parse(fileContent);

    // Check expiry
    if (Date.now() > cacheEntry.expiryTime) {
      fs.unlinkSync(filePath);
      Logger.debug(`Session expired and deleted: ${sessionId}`);
      return null;
    }

    Logger.debug(`Loaded review session: ${sessionId} (${cacheEntry.session.totalRounds} rounds)`);
    return cacheEntry.session;
  } catch (error) {
    Logger.error(`Failed to load review session ${sessionId}: ${error}`);
    // Clean up corrupted file
    try {
      fs.unlinkSync(filePath);
    } catch {}
    return null;
  }
}

/**
 * Lists all active review sessions
 * @returns Array of active sessions
 */
export function listActiveSessions(): CodeReviewSession[] {
  ensureCacheDir();
  const sessions: CodeReviewSession[] = [];

  try {
    const files = fs.readdirSync(REVIEW_CACHE_DIR);
    const now = Date.now();

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(REVIEW_CACHE_DIR, file);
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const cacheEntry: ReviewSessionCacheEntry = JSON.parse(fileContent);

        // Skip expired sessions
        if (now <= cacheEntry.expiryTime) {
          sessions.push(cacheEntry.session);
        }
      } catch (error) {
        Logger.debug(`Error reading session file ${file}: ${error}`);
      }
    }
  } catch (error) {
    Logger.error(`Failed to list active sessions: ${error}`);
  }

  return sessions;
}

/**
 * Cleans up expired session files
 */
function cleanExpiredSessions(): void {
  try {
    ensureCacheDir();
    const files = fs.readdirSync(REVIEW_CACHE_DIR);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(REVIEW_CACHE_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > REVIEW_SESSION_TTL) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (error) {
        Logger.debug(`Error checking session file ${file}: ${error}`);
      }
    }

    if (cleaned > 0) {
      Logger.debug(`Cleaned ${cleaned} expired review sessions`);
    }
  } catch (error) {
    Logger.debug(`Session cleanup error: ${error}`);
  }
}

/**
 * Enforces the maximum session limit using FIFO
 */
function enforceSessionLimits(): void {
  try {
    const files = fs
      .readdirSync(REVIEW_CACHE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(REVIEW_CACHE_DIR, f),
        mtime: fs.statSync(path.join(REVIEW_CACHE_DIR, f)).mtimeMs
      }))
      .sort((a, b) => a.mtime - b.mtime); // Oldest first

    // Remove oldest files if over limit
    if (files.length > MAX_REVIEW_SESSIONS) {
      const toRemove = files.slice(0, files.length - MAX_REVIEW_SESSIONS);
      for (const file of toRemove) {
        try {
          fs.unlinkSync(file.path);
        } catch {}
      }
      Logger.debug(`Removed ${toRemove.length} old review sessions to enforce limit`);
    }
  } catch (error) {
    Logger.debug(`Error enforcing session limits: ${error}`);
  }
}

/**
 * Creates a new review session
 * @param sessionId The session ID
 * @param gitState The initial git state
 * @param focusFiles Optional files to focus on
 * @returns New CodeReviewSession object
 */
export function createNewSession(
  sessionId: string,
  gitState: GitState,
  focusFiles?: string[]
): CodeReviewSession {
  const now = Date.now();
  return {
    sessionId,
    createdAt: now,
    lastAccessedAt: now,
    gitState,
    currentGitState: gitState,
    rounds: [],
    allComments: [],
    filesTracked: [],
    focusFiles,
    reviewScope: focusFiles ? 'focused' : 'full',
    totalRounds: 0,
    sessionState: 'active'
  };
}

/**
 * Gets cache statistics
 * @returns Cache stats object
 */
export function getReviewCacheStats(): {
  size: number;
  ttl: number;
  maxSize: number;
  cacheDir: string;
} {
  ensureCacheDir();
  let size = 0;

  try {
    const files = fs.readdirSync(REVIEW_CACHE_DIR);
    size = files.filter(f => f.endsWith('.json')).length;
  } catch {}

  return {
    size,
    ttl: REVIEW_SESSION_TTL,
    maxSize: MAX_REVIEW_SESSIONS,
    cacheDir: REVIEW_CACHE_DIR
  };
}
