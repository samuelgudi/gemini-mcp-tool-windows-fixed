import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeGeminiCLI, processChangeModeOutput } from '../utils/geminiExecutor.js';
import {
  ERROR_MESSAGES,
  STATUS_MESSAGES
} from '../constants.js';
import { askGeminiSessionManager } from '../utils/askGeminiSessionManager.js';
import { extractFilesFromPrompt } from '../utils/reviewPromptBuilder.js';

const askGeminiArgsSchema = z.object({
  prompt: z.string().min(1).describe("Analysis request. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions"),
  session: z.string().optional().describe("Session ID for conversation continuity (e.g., 'typescript-learning'). Maintains context across multiple questions."),
  model: z.string().optional().describe("Optional model to use (e.g., 'gemini-2.5-flash'). If not specified, uses the default model (gemini-2.5-pro)."),
  sandbox: z.boolean().default(false).describe("Use sandbox mode (-s flag) to safely test code changes, execute scripts, or run potentially risky operations in an isolated environment"),
  changeMode: z.boolean().default(false).describe("Enable structured change mode - formats prompts to prevent tool errors and returns structured edit suggestions that Claude can apply directly"),
  includeHistory: z.boolean().default(true).describe("Include conversation history in context (only applies when session is provided). Default: true"),
  chunkIndex: z.union([z.number(), z.string()]).optional().describe("Which chunk to return (1-based)"),
  chunkCacheKey: z.string().optional().describe("Optional cache key for continuation"),
});

export const askGeminiTool: UnifiedTool = {
  name: "ask-gemini",
  description: "model selection [-m], sandbox [-s], and changeMode:boolean for providing edits",
  zodSchema: askGeminiArgsSchema,
  prompt: {
    description: "Execute 'gemini -p <prompt>' to get Gemini AI's response. Supports enhanced change mode for structured edit suggestions.",
  },
  category: 'gemini',
  execute: async (args, onProgress) => {
    const { prompt, session, model, sandbox, changeMode, includeHistory, chunkIndex, chunkCacheKey } = args;

    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    // Handle chunking (existing logic)
    if (changeMode && chunkIndex && chunkCacheKey) {
      return processChangeModeOutput(
        '',
        chunkIndex as number,
        chunkCacheKey as string,
        prompt as string
      );
    }

    // Session handling
    let sessionData = null;
    let enhancedPrompt = prompt as string;

    if (session) {
      sessionData = askGeminiSessionManager.getOrCreate(session as string);

      // Build conversation context if history is enabled
      if (includeHistory && sessionData.conversationHistory.length > 0) {
        const historyContext = askGeminiSessionManager.buildConversationContext(sessionData, 3);
        enhancedPrompt = `${historyContext}\n\n# Current Question\n${prompt}`;
      }

      onProgress?.(`📝 Session '${session}' (Round ${sessionData.totalRounds + 1})`);
    }

    const result = await executeGeminiCLI(
      enhancedPrompt,
      model as string | undefined,
      !!sandbox,
      !!changeMode,
      onProgress
    );

    // Save to session if provided
    if (session && sessionData) {
      const contextFiles = extractFilesFromPrompt(prompt as string);
      askGeminiSessionManager.addRound(
        sessionData,
        prompt as string,
        result,
        model as string || 'gemini-2.5-pro',
        contextFiles
      );
      askGeminiSessionManager.save(sessionData);
      onProgress?.(`💾 Saved to session '${session}' (${sessionData.totalRounds} rounds)`);
    }

    if (changeMode) {
      return processChangeModeOutput(
        result,
        args.chunkIndex as number | undefined,
        undefined,
        prompt as string
      );
    }

    return `${STATUS_MESSAGES.GEMINI_RESPONSE}\n${result}`;
  }
};