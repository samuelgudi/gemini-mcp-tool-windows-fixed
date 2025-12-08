import { SessionManager } from './sessionManager.js';
import { ReviewCodeSessionData } from './sessionSchemas.js';
import { GitState } from './gitStateDetector.js';

/**
 * Specialized session manager for review-code tool
 * Wraps generic SessionManager with review-specific helpers
 * Maintains backward compatibility with reviewSessionCache.ts
 */
export class ReviewSessionManager {
  private sessionManager: SessionManager<ReviewCodeSessionData>;

  constructor() {
    this.sessionManager = new SessionManager<ReviewCodeSessionData>('review-code');
  }

  /**
   * Saves a review session (maintains existing interface)
   */
  saveReviewSession(session: ReviewCodeSessionData): void {
    this.sessionManager.save(session.sessionId, session);
  }

  /**
   * Loads a review session (maintains existing interface)
   */
  loadReviewSession(sessionId: string): ReviewCodeSessionData | null {
    return this.sessionManager.load(sessionId);
  }

  /**
   * Lists active review sessions
   */
  listActiveSessions(): ReviewCodeSessionData[] {
    return this.sessionManager.list();
  }

  /**
   * Creates a new review session
   */
  createNewSession(
    sessionId: string,
    gitState: GitState,
    focusFiles?: string[]
  ): ReviewCodeSessionData {
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
   */
  getReviewCacheStats() {
    return this.sessionManager.getStats();
  }
}

// Export singleton instance for backward compatibility
export const reviewSessionManager = new ReviewSessionManager();

// Export existing function signatures for drop-in replacement
export const saveReviewSession = (session: ReviewCodeSessionData) =>
  reviewSessionManager.saveReviewSession(session);

export const loadReviewSession = (sessionId: string) =>
  reviewSessionManager.loadReviewSession(sessionId);

export const listActiveSessions = () =>
  reviewSessionManager.listActiveSessions();

export const createNewSession = (
  sessionId: string,
  gitState: GitState,
  focusFiles?: string[]
) => reviewSessionManager.createNewSession(sessionId, gitState, focusFiles);

export const getReviewCacheStats = () =>
  reviewSessionManager.getReviewCacheStats();
