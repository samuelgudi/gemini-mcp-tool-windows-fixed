// Tool Registry Index - Registers all tools
import { toolRegistry } from './registry.js';
import { askGeminiTool } from './ask-gemini.tool.js';
import { pingTool } from './simple-tools.js';
import { brainstormTool } from './brainstorm.tool.js';
import { fetchChunkTool } from './fetch-chunk.tool.js';
import { timeoutTestTool } from './timeout-test.tool.js';
import { reviewCodeTool } from './review-code.tool.js';

toolRegistry.push(
  askGeminiTool,
  pingTool,
  brainstormTool,
  fetchChunkTool,
  timeoutTestTool,
  reviewCodeTool
);

export * from './registry.js';