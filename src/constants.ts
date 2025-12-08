

// Logging
export const LOG_PREFIX = "[GMCPT]";

// Error messages
export const ERROR_MESSAGES = {
  QUOTA_EXCEEDED: "Quota exceeded for quota metric 'Gemini 2.5 Pro Requests'",
  QUOTA_EXCEEDED_SHORT: "⚠️ Gemini 2.5 Pro daily quota exceeded. Please retry with model: 'gemini-2.5-flash'",
  TOOL_NOT_FOUND: "not found in registry",
  NO_PROMPT_PROVIDED: "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions",
} as const;

// Status messages
export const STATUS_MESSAGES = {
  QUOTA_SWITCHING: "🚫 Gemini 2.5 Pro quota exceeded, switching to Flash model...",
  FLASH_RETRY: "⚡ Retrying with Gemini 2.5 Flash...",
  FLASH_SUCCESS: "✅ Flash model completed successfully",
  SANDBOX_EXECUTING: "🔒 Executing Gemini CLI command in sandbox mode...",
  GEMINI_RESPONSE: "Gemini response:",
  // Timeout prevention messages
  PROCESSING_START: "🔍 Starting analysis (may take 5-15 minutes for large codebases)",
  PROCESSING_CONTINUE: "⏳ Still processing... Gemini is working on your request",
  PROCESSING_COMPLETE: "✅ Analysis completed successfully",
} as const;

// Models
export const MODELS = {
  PRO: "gemini-2.5-pro",
  FLASH: "gemini-2.5-flash",
} as const;

// MCP Protocol Constants
export const PROTOCOL = {
  // Message roles
  ROLES: {
    USER: "user",
    ASSISTANT: "assistant",
  },
  // Content types
  CONTENT_TYPES: {
    TEXT: "text",
  },
  // Status codes
  STATUS: {
    SUCCESS: "success",
    ERROR: "error",
    FAILED: "failed",
    REPORT: "report",
  },
  // Notification methods
  NOTIFICATIONS: {
    PROGRESS: "notifications/progress",
  },
  // Timeout prevention
  KEEPALIVE_INTERVAL: 25000, // 25 seconds
} as const;


// CLI Constants
export const CLI = {
  // Command names
  COMMANDS: {
    GEMINI: "gemini",
    ECHO: "echo",
  },
  // Command flags
  FLAGS: {
    MODEL: "-m",
    SANDBOX: "-s",
    PROMPT: "-p",
    HELP: "-help",
  },
  // Default values
  DEFAULTS: {
    MODEL: "default", // Fallback model used when no specific model is provided
    BOOLEAN_TRUE: "true",
    BOOLEAN_FALSE: "false",
  },
} as const;

// Shared Session Management Constants
export const SESSION = {
  BASE_DIR: '.gemini-mcp/sessions', // Base directory in user's home
  DEFAULT_TTL: 24 * 60 * 60 * 1000, // 24 hours default
  DEFAULT_MAX_SESSIONS: 20,
  DEFAULT_EVICTION_POLICY: 'lru' as const,

  // Per-tool configurations
  TOOL_CONFIGS: {
    'review-code': {
      TTL: 24 * 60 * 60 * 1000, // 24 hours
      MAX_SESSIONS: 20,
      EVICTION_POLICY: 'fifo' as const
    },
    'ask-gemini': {
      TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
      MAX_SESSIONS: 50,
      EVICTION_POLICY: 'lru' as const
    },
    'brainstorm': {
      TTL: 14 * 24 * 60 * 60 * 1000, // 14 days
      MAX_SESSIONS: 30,
      EVICTION_POLICY: 'lru' as const
    }
  }
} as const;

// Code Review Constants
export const REVIEW = {
  // Session configuration (deprecated - use SESSION constants)
  SESSION: {
    TTL: 60 * 60 * 1000, // 60 minutes (deprecated)
    MAX_SESSIONS: 20,
    CACHE_DIR_NAME: 'gemini-mcp-review-sessions', // deprecated
  },
  // Review types
  TYPES: {
    SECURITY: 'security',
    PERFORMANCE: 'performance',
    QUALITY: 'quality',
    ARCHITECTURE: 'architecture',
    GENERAL: 'general',
  },
  // Comment severity levels
  SEVERITY: {
    CRITICAL: 'critical',
    IMPORTANT: 'important',
    SUGGESTION: 'suggestion',
    QUESTION: 'question',
  },
  // Comment status
  STATUS: {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    MODIFIED: 'modified',
    DEFERRED: 'deferred',
  },
  // Session state
  SESSION_STATE: {
    ACTIVE: 'active',
    PAUSED: 'paused',
    COMPLETED: 'completed',
  },
  // Review scope
  SCOPE: {
    FULL: 'full',
    CHANGES_ONLY: 'changes-only',
    FOCUSED: 'focused',
  },
  // Formatting
  MAX_HISTORY_ROUNDS: 3, // How many previous rounds to include in context
  SEVERITY_EMOJI: {
    critical: '🔴',
    important: '🟠',
    suggestion: '🟡',
    question: '💬',
  } as const,
} as const;


// (merged PromptArguments and ToolArguments)
export interface ToolArguments {
  prompt?: string;
  model?: string;
  sandbox?: boolean | string;
  changeMode?: boolean | string;
  chunkIndex?: number | string; // Which chunk to return (1-based)
  chunkCacheKey?: string; // Optional cache key for continuation
  message?: string; // For Ping tool -- Un-used.

  // --> shared session parameters (ask-gemini, brainstorm, review-code)
  session?: string; // Session ID for conversation continuity
  includeHistory?: boolean; // Include conversation/review history in prompt

  // --> brainstorm tool
  methodology?: string; // Brainstorming framework to use
  domain?: string; // Domain context for specialized brainstorming
  constraints?: string; // Known limitations or requirements
  existingContext?: string; // Background information to build upon
  ideaCount?: number; // Target number of ideas to generate
  includeAnalysis?: boolean; // Include feasibility and impact analysis

  // --> review-code tool
  files?: string[]; // Specific files to review
  sessionId?: string; // Explicit session ID override (review-code uses this OR git-based)
  forceNewSession?: boolean; // Force create new session
  reviewType?: string; // Type of review (security, performance, etc.)
  severity?: string; // Filter by severity level
  commentDecisions?: Array<{
    commentId: string;
    decision: string;
    notes?: string;
  }>; // Decision tracking for previous comments

  [key: string]: string | boolean | number | undefined | string[] | Array<any>; // Allow additional properties
}