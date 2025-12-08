import { SessionManager } from './sessionManager.js';
import { BrainstormSessionData } from './sessionSchemas.js';
import { randomUUID } from 'node:crypto';

/**
 * Session manager for brainstorm tool
 * Tracks iterative ideation with ideas and feedback
 */
export class BrainstormSessionManager {
  private sessionManager: SessionManager<BrainstormSessionData>;

  constructor() {
    this.sessionManager = new SessionManager<BrainstormSessionData>('brainstorm');
  }

  /**
   * Creates a new brainstorming session
   */
  createSession(
    sessionId: string,
    challenge: string,
    methodology: string,
    domain?: string,
    constraints?: string
  ): BrainstormSessionData {
    const now = Date.now();
    return {
      sessionId,
      createdAt: now,
      lastAccessedAt: now,
      challenge,
      methodology,
      domain,
      constraints,
      rounds: [],
      totalIdeas: 0,
      activeIdeas: 0,
      refinementHistory: []
    };
  }

  /**
   * Adds a brainstorming round with generated ideas
   */
  addRound(
    session: BrainstormSessionData,
    userPrompt: string,
    geminiResponse: string,
    ideas: Array<{
      name: string;
      description: string;
      feasibility?: number;
      impact?: number;
      innovation?: number;
    }>
  ): BrainstormSessionData {
    const parsedIdeas = ideas.map(idea => ({
      ideaId: `idea-${randomUUID()}`,
      name: idea.name,
      description: idea.description,
      feasibility: idea.feasibility,
      impact: idea.impact,
      innovation: idea.innovation,
      status: 'active' as const
    }));

    session.rounds.push({
      roundNumber: session.rounds.length + 1,
      timestamp: Date.now(),
      userPrompt,
      geminiResponse,
      ideasGenerated: parsedIdeas
    });

    session.totalIdeas += parsedIdeas.length;
    session.activeIdeas += parsedIdeas.length;
    session.lastAccessedAt = Date.now();

    return session;
  }

  /**
   * Records idea refinement action
   */
  refineIdeas(
    session: BrainstormSessionData,
    action: 'refined' | 'merged' | 'discarded',
    ideaIds: string[],
    reason: string
  ): BrainstormSessionData {
    session.refinementHistory.push({
      timestamp: Date.now(),
      action,
      ideaIds,
      reason
    });

    // Update idea statuses
    for (const round of session.rounds) {
      for (const idea of round.ideasGenerated) {
        if (ideaIds.includes(idea.ideaId)) {
          if (action === 'discarded') {
            idea.status = 'discarded';
            session.activeIdeas--;
          } else if (action === 'merged') {
            idea.status = 'merged';
            session.activeIdeas--;
          } else {
            idea.status = 'refined';
          }
        }
      }
    }

    return session;
  }

  /**
   * Builds context from previous rounds' ideas
   * @param session The session to build context from
   * @param activeOnly Only include active/refined ideas (exclude discarded/merged)
   * @returns Formatted ideas context
   */
  buildIdeasContext(session: BrainstormSessionData, activeOnly: boolean = true): string {
    if (session.rounds.length === 0) {
      return '';
    }

    const allIdeas = session.rounds.flatMap(round => round.ideasGenerated);
    const filteredIdeas = activeOnly
      ? allIdeas.filter(idea => idea.status === 'active' || idea.status === 'refined')
      : allIdeas;

    if (filteredIdeas.length === 0) {
      return '';
    }

    const ideaList = filteredIdeas.map(idea => {
      let ideaText = `- **${idea.name}**: ${idea.description}`;
      if (idea.status !== 'active') {
        ideaText += ` [${idea.status.toUpperCase()}]`;
      }
      if (idea.feasibility || idea.impact || idea.innovation) {
        const scores = [];
        if (idea.feasibility) scores.push(`Feasibility: ${idea.feasibility}/10`);
        if (idea.impact) scores.push(`Impact: ${idea.impact}/10`);
        if (idea.innovation) scores.push(`Innovation: ${idea.innovation}/10`);
        ideaText += ` (${scores.join(', ')})`;
      }
      return ideaText;
    }).join('\n');

    return `# Previously Generated Ideas\n\n${ideaList}`;
  }

  /**
   * Saves a session
   */
  save(session: BrainstormSessionData): void {
    this.sessionManager.save(session.sessionId, session);
  }

  /**
   * Loads a session
   */
  load(sessionId: string): BrainstormSessionData | null {
    return this.sessionManager.load(sessionId);
  }

  /**
   * Lists all sessions
   */
  list(): BrainstormSessionData[] {
    return this.sessionManager.list();
  }

  /**
   * Deletes a session
   */
  delete(sessionId: string): boolean {
    return this.sessionManager.delete(sessionId);
  }

  /**
   * Gets or creates a session
   */
  getOrCreate(
    sessionId: string,
    challenge: string,
    methodology: string,
    domain?: string,
    constraints?: string
  ): BrainstormSessionData {
    const existing = this.load(sessionId);
    if (existing) {
      return existing;
    }
    return this.createSession(sessionId, challenge, methodology, domain, constraints);
  }

  /**
   * Gets cache statistics
   */
  getStats() {
    return this.sessionManager.getStats();
  }
}

// Export singleton instance
export const brainstormSessionManager = new BrainstormSessionManager();
