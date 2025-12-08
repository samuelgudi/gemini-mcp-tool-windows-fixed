import { SessionManager } from './sessionManager.js';
import { AskGeminiSessionData } from './sessionSchemas.js';

/**
 * Session manager for ask-gemini tool
 * Tracks multi-turn conversations with context
 */
export class AskGeminiSessionManager {
  private sessionManager: SessionManager<AskGeminiSessionData>;

  constructor() {
    this.sessionManager = new SessionManager<AskGeminiSessionData>('ask-gemini');
  }

  /**
   * Creates a new conversation session
   */
  createSession(sessionId: string): AskGeminiSessionData {
    const now = Date.now();
    return {
      sessionId,
      createdAt: now,
      lastAccessedAt: now,
      conversationHistory: [],
      totalRounds: 0,
      contextFiles: [],
      metadata: {}
    };
  }

  /**
   * Adds a conversation round to the session
   */
  addRound(
    session: AskGeminiSessionData,
    userPrompt: string,
    geminiResponse: string,
    model: string,
    contextFiles?: string[]
  ): AskGeminiSessionData {
    session.conversationHistory.push({
      roundNumber: session.totalRounds + 1,
      timestamp: Date.now(),
      userPrompt,
      geminiResponse,
      model
    });

    session.totalRounds++;
    session.lastAccessedAt = Date.now();

    // Track context files
    if (contextFiles && contextFiles.length > 0) {
      session.contextFiles = [...new Set([...session.contextFiles, ...contextFiles])];
    }

    return session;
  }

  /**
   * Builds conversation context from history for inclusion in prompts
   * @param session The session to build context from
   * @param maxRounds Maximum number of previous rounds to include (default: 3)
   * @returns Formatted conversation context
   */
  buildConversationContext(session: AskGeminiSessionData, maxRounds: number = 3): string {
    if (session.conversationHistory.length === 0) {
      return '';
    }

    const recentRounds = session.conversationHistory.slice(-maxRounds);

    const contextParts = recentRounds.map(round => {
      // Truncate long responses for context
      const truncatedResponse = round.geminiResponse.length > 500
        ? round.geminiResponse.slice(0, 500) + '...'
        : round.geminiResponse;

      return `[Round ${round.roundNumber}]
User: ${round.userPrompt}
Gemini: ${truncatedResponse}`;
    });

    return `# Conversation History\n\n${contextParts.join('\n\n')}`;
  }

  /**
   * Saves a session
   */
  async save(session: AskGeminiSessionData): Promise<void> {
    await this.sessionManager.save(session.sessionId, session);
  }

  /**
   * Loads a session
   */
  async load(sessionId: string): Promise<AskGeminiSessionData | null> {
    return await this.sessionManager.load(sessionId);
  }

  /**
   * Lists all sessions
   */
  async list(): Promise<AskGeminiSessionData[]> {
    return await this.sessionManager.list();
  }

  /**
   * Deletes a session
   */
  async delete(sessionId: string): Promise<boolean> {
    return await this.sessionManager.delete(sessionId);
  }

  /**
   * Gets or creates a session
   */
  async getOrCreate(sessionId: string): Promise<AskGeminiSessionData> {
    const existing = await this.load(sessionId);
    if (existing) {
      return existing;
    }
    return this.createSession(sessionId);
  }

  /**
   * Gets cache statistics
   */
  async getStats() {
    return await this.sessionManager.getStats();
  }
}

// Export singleton instance
export const askGeminiSessionManager = new AskGeminiSessionManager();
