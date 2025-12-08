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
  async saveReviewSession(session: ReviewCodeSessionData): Promise<void> {
    await this.sessionManager.save(session.sessionId, session);
  }

  /**
   * Loads a review session (maintains existing interface)
   */
  async loadReviewSession(sessionId: string): Promise<ReviewCodeSessionData | null> {
    return await this.sessionManager.load(sessionId);
  }

  /**
   * Lists active review sessions
   */
  async listActiveSessions(): Promise<ReviewCodeSessionData[]> {
    return await this.sessionManager.list();
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
  async getReviewCacheStats() {
    return await this.sessionManager.getStats();
  }
}

// Export singleton instance for backward compatibility
export const reviewSessionManager = new ReviewSessionManager();

// Export existing function signatures for drop-in replacement
export const saveReviewSession = async (session: ReviewCodeSessionData) =>
  await reviewSessionManager.saveReviewSession(session);

export const loadReviewSession = async (sessionId: string) =>
  await reviewSessionManager.loadReviewSession(sessionId);

export const listActiveSessions = async () =>
  await reviewSessionManager.listActiveSessions();

export const createNewSession = (
  sessionId: string,
  gitState: GitState,
  focusFiles?: string[]
) => reviewSessionManager.createNewSession(sessionId, gitState, focusFiles);

export const getReviewCacheStats = async () =>
  await reviewSessionManager.getReviewCacheStats();
