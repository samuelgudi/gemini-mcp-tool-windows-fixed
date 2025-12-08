import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeGeminiCLI } from '../utils/geminiExecutor.js';
import {
  getCurrentGitState,
  generateSessionId,
  detectSessionContinuation
} from '../utils/gitStateDetector.js';
import {
  loadReviewSession,
  saveReviewSession,
  createNewSession
} from '../utils/reviewSessionManager.js';
import type {
  ReviewCodeSessionData as CodeReviewSession,
} from '../utils/sessionSchemas.js';
import type { ReviewComment, ReviewRound } from '../utils/reviewSessionCache.js';
import { buildReviewPrompt, extractFilesFromPrompt } from '../utils/reviewPromptBuilder.js';
import { parseReviewResponse, validateComments } from '../utils/reviewResponseParser.js';
import {
  formatReviewResponse,
  formatSessionNotFound,
  formatGitStateWarning
} from '../utils/reviewFormatter.js';
import { STATUS_MESSAGES } from '../constants.js';
import { Logger } from '../utils/logger.js';

const reviewCodeArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('Review request or follow-up question'),
  files: z
    .array(z.string())
    .optional()
    .describe('Specific files to review (uses @ syntax internally)'),
  sessionId: z
    .string()
    .optional()
    .describe('Explicit session ID to continue (auto-detected from git if omitted)'),
  forceNewSession: z
    .boolean()
    .default(false)
    .describe('Force create new session ignoring git state'),
  reviewType: z
    .enum(['security', 'performance', 'quality', 'architecture', 'general'])
    .default('general')
    .describe('Type of review to perform'),
  severity: z
    .enum(['all', 'critical-only', 'important-and-above'])
    .default('all')
    .describe('Filter issues by severity level'),
  commentDecisions: z
    .array(
      z.object({
        commentId: z.string(),
        decision: z.enum(['accept', 'reject', 'modify', 'defer']),
        notes: z.string().optional()
      })
    )
    .optional()
    .describe('Responses to previous round\'s comments'),
  model: z.string().optional().describe('Optional model to use'),
  includeHistory: z
    .boolean()
    .default(true)
    .describe('Include conversation history in prompt')
});

export const reviewCodeTool: UnifiedTool = {
  name: 'review-code',
  description:
    'Interactive code review with session continuity. Auto-detects git state for session management. Maintains conversation history and tracks review decisions across iterations.',
  zodSchema: reviewCodeArgsSchema,
  category: 'gemini',

  execute: async (args, onProgress) => {
    const {
      prompt,
      files,
      sessionId,
      forceNewSession,
      reviewType,
      severity,
      commentDecisions,
      model,
      includeHistory
    } = args;

    try {
      // Step 1: Determine session
      onProgress?.('🔍 Detecting git state and session...');
      const currentGitState = await getCurrentGitState();
      const detectedSessionId = generateSessionId(currentGitState);
      const targetSessionId = sessionId || detectedSessionId;

      Logger.debug(`Current git state: ${currentGitState.branch} @ ${currentGitState.commitHash.slice(0, 8)}`);
      Logger.debug(`Target session ID: ${targetSessionId}`);

      // Step 2: Load or create session
      let session: CodeReviewSession;
      let isNewSession = false;

      if (forceNewSession) {
        Logger.debug('Force new session requested');
        session = createNewSession(targetSessionId, currentGitState, files);
        isNewSession = true;
      } else {
        const existing = await loadReviewSession(targetSessionId);

        if (existing) {
          // Validate git state hasn't diverged
          const continuationCheck = detectSessionContinuation(
            currentGitState,
            existing.gitState
          );

          if (!continuationCheck.canContinue) {
            onProgress?.(formatGitStateWarning(continuationCheck.reason!, true));
          }

          session = existing;
          session.currentGitState = currentGitState;
          Logger.debug(`Loaded existing session with ${session.totalRounds} rounds`);
        } else {
          if (sessionId) {
            // User explicitly requested a session that doesn't exist
            return formatSessionNotFound(
              targetSessionId,
              currentGitState.branch,
              currentGitState.commitHash
            );
          }
          // Create new session
          session = createNewSession(targetSessionId, currentGitState, files);
          isNewSession = true;
          Logger.debug('Created new session');
        }
      }

      // Step 3: Process comment decisions from previous round
      if (commentDecisions && commentDecisions.length > 0) {
        applyCommentDecisions(session, commentDecisions);
        onProgress?.(`✅ Applied ${commentDecisions.length} comment decision(s)`);
      }

      // Step 4: Update files tracked - use Set for efficient uniqueness handling
      if (files && files.length > 0) {
        session.filesTracked = [...new Set([...session.filesTracked, ...files])];
      }

      // Step 5: Build review prompt with context
      const reviewPrompt = buildReviewPrompt({
        userPrompt: prompt as string,
        session,
        files: files as string[] | undefined,
        reviewType: reviewType as string,
        includeHistory: !!includeHistory,
        currentGitState
      });

      Logger.debug(`Built review prompt (${reviewPrompt.length} chars)`);

      // Step 6: Execute Gemini review
      onProgress?.(
        `🔍 Round ${session.totalRounds + 1}: Reviewing ${files?.length || 'tracked'} file(s)...`
      );

      const geminiResponse = await executeGeminiCLI(
        reviewPrompt,
        model as string | undefined,
        false, // sandbox
        false, // changeMode - we parse manually
        onProgress
      );

      // Step 7: Parse response into structured comments
      onProgress?.('📝 Parsing review feedback...');
      let newComments = parseReviewResponse(geminiResponse, session.totalRounds + 1);
      newComments = validateComments(newComments);

      // Apply severity filter if requested
      if (severity === 'critical-only') {
        newComments = newComments.filter(c => c.severity === 'critical');
      } else if (severity === 'important-and-above') {
        newComments = newComments.filter(
          c => c.severity === 'critical' || c.severity === 'important'
        );
      }

      Logger.debug(`Parsed ${newComments.length} comments (after filtering)`);

      // Step 8: Create new review round
      const filesReviewed = files || extractFilesFromPrompt(reviewPrompt);
      const newRound: ReviewRound = {
        roundNumber: session.totalRounds + 1,
        timestamp: Date.now(),
        filesReviewed: filesReviewed as string[],
        userPrompt: prompt as string,
        geminiResponse,
        commentsGenerated: newComments,
        gitState: currentGitState
      };

      session.rounds.push(newRound);
      session.allComments.push(...newComments);
      session.totalRounds++;
      session.lastAccessedAt = Date.now();

      // Step 9: Save session
      await saveReviewSession(session);
      onProgress?.('💾 Session saved');

      // Step 10: Format and return response
      const formattedResponse = formatReviewResponse({
        session,
        currentRound: newRound,
        newComments,
        showHistory: !!includeHistory
      });

      return formattedResponse;
    } catch (error) {
      Logger.error(`Review code execution error: ${error}`);
      throw new Error(`Code review failed: ${error}`);
    }
  }
};

/**
 * Applies comment decisions from the user to the session
 * Uses Map for O(1) comment lookups instead of O(N) linear search
 * @param session The current session
 * @param decisions Array of comment decisions
 */
function applyCommentDecisions(
  session: CodeReviewSession,
  decisions: Array<{ commentId: string; decision: string; notes?: string }>
): void {
  // Create a Map for O(1) lookups instead of O(N) linear search
  const commentMap = new Map(session.allComments.map(c => [c.id, c]));

  for (const decision of decisions) {
    const comment = commentMap.get(decision.commentId);

    if (comment) {
      comment.status = decision.decision as ReviewComment['status'];
      if (decision.notes) {
        comment.resolution = decision.notes;
      }
      Logger.debug(`Applied decision '${decision.decision}' to comment ${decision.commentId}`);
    } else {
      Logger.debug(`Comment ${decision.commentId} not found in session`);
    }
  }
}
