import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { Logger } from '../utils/logger.js';
import { executeGeminiCLI } from '../utils/geminiExecutor.js';
import { brainstormSessionManager } from '../utils/brainstormSessionManager.js';

function buildBrainstormPrompt(config: {
  prompt: string;
  methodology: string;
  domain?: string;
  constraints?: string;
  existingContext?: string;
  ideaCount: number;
  includeAnalysis: boolean;
}): string {
  const { prompt, methodology, domain, constraints, existingContext, ideaCount, includeAnalysis } = config;
  
  // Select methodology framework
  let frameworkInstructions = getMethodologyInstructions(methodology, domain);
  
  let enhancedPrompt = `# BRAINSTORMING SESSION

## Core Challenge
${prompt}

## Methodology Framework
${frameworkInstructions}

## Context Engineering
*Use the following context to inform your reasoning:*
${domain ? `**Domain Focus:** ${domain} - Apply domain-specific knowledge, terminology, and best practices.` : ''}
${constraints ? `**Constraints & Boundaries:** ${constraints}` : ''}
${existingContext ? `**Background Context:** ${existingContext}` : ''}

## Output Requirements
- Generate ${ideaCount} distinct, creative ideas
- Each idea should be unique and non-obvious
- Focus on actionable, implementable concepts
- Use clear, descriptive naming
- Provide brief explanations for each idea

${includeAnalysis ? `
## Analysis Framework
For each idea, provide:
- **Feasibility:** Implementation difficulty (1-5 scale)
- **Impact:** Potential value/benefit (1-5 scale)
- **Innovation:** Uniqueness/creativity (1-5 scale)
- **Quick Assessment:** One-sentence evaluation
` : ''}

## Format
Present ideas in a structured format:

### Idea [N]: [Creative Name]
**Description:** [2-3 sentence explanation]
${includeAnalysis ? '**Feasibility:** [1-5] | **Impact:** [1-5] | **Innovation:** [1-5]\n**Assessment:** [Brief evaluation]' : ''}

---

**Before finalizing, review the list: remove near-duplicates and ensure each idea satisfies the constraints.**

Begin brainstorming session:`;

  return enhancedPrompt;
}

/**
 * Returns methodology-specific instructions for structured brainstorming
 */
function getMethodologyInstructions(methodology: string, domain?: string): string {
  const methodologies: Record<string, string> = {
    'divergent': `**Divergent Thinking Approach:**
- Generate maximum quantity of ideas without self-censoring
- Build on wild or seemingly impractical ideas
- Combine unrelated concepts for unexpected solutions
- Use "Yes, and..." thinking to expand each concept
- Postpone evaluation until all ideas are generated`,

    'convergent': `**Convergent Thinking Approach:**
- Focus on refining and improving existing concepts
- Synthesize related ideas into stronger solutions
- Apply critical evaluation criteria
- Prioritize based on feasibility and impact
- Develop implementation pathways for top ideas`,

    'scamper': `**SCAMPER Creative Triggers:**
- **Substitute:** What can be substituted or replaced?
- **Combine:** What can be combined or merged?
- **Adapt:** What can be adapted from other domains?
- **Modify:** What can be magnified, minimized, or altered?
- **Put to other use:** How else can this be used?
- **Eliminate:** What can be removed or simplified?
- **Reverse:** What can be rearranged or reversed?`,

    'design-thinking': `**Human-Centered Design Thinking:**
- **Empathize:** Consider user needs, pain points, and contexts
- **Define:** Frame problems from user perspective
- **Ideate:** Generate user-focused solutions
- **Consider Journey:** Think through complete user experience
- **Prototype Mindset:** Focus on testable, iterative concepts`,

    'lateral': `**Lateral Thinking Approach:**
- Make unexpected connections between unrelated fields
- Challenge fundamental assumptions
- Use random word association to trigger new directions
- Apply metaphors and analogies from other domains
- Reverse conventional thinking patterns`,

    'auto': `**AI-Optimized Approach:**
${domain ? `Given the ${domain} domain, I'll apply the most effective combination of:` : 'I\'ll intelligently combine multiple methodologies:'}
- Divergent exploration with domain-specific knowledge
- SCAMPER triggers and lateral thinking
- Human-centered perspective for practical value`
  };

  return methodologies[methodology] || methodologies['auto'];
}

const brainstormArgsSchema = z.object({
  prompt: z.string().min(1).describe("Primary brainstorming challenge or question to explore"),
  session: z.string().optional().describe("Session ID for tracking ideas across rounds (e.g., 'feature-ideas'). Enables iterative brainstorming with context."),
  model: z.string().optional().describe("Optional model: 'gemini-3-pro-preview' (default), 'gemini-2.5-pro', 'gemini-2.5-flash'"),
  methodology: z.enum(['divergent', 'convergent', 'scamper', 'design-thinking', 'lateral', 'auto']).default('auto').describe("Brainstorming framework: 'divergent' (generate many ideas), 'convergent' (refine existing), 'scamper' (systematic triggers), 'design-thinking' (human-centered), 'lateral' (unexpected connections), 'auto' (AI selects best)"),
  domain: z.string().optional().describe("Domain context for specialized brainstorming (e.g., 'software', 'business', 'creative', 'research', 'product', 'marketing')"),
  constraints: z.string().optional().describe("Known limitations, requirements, or boundaries (budget, time, technical, legal, etc.)"),
  existingContext: z.string().optional().describe("Background information, previous attempts, or current state to build upon"),
  ideaCount: z.number().int().positive().default(12).describe("Target number of ideas to generate (default: 10-15)"),
  includeAnalysis: z.boolean().default(true).describe("Include feasibility, impact, and implementation analysis for generated ideas"),
  includeHistory: z.boolean().default(true).describe("Include previously generated ideas in context (only applies when session is provided). Default: true"),
  allowedTools: z.array(z.string()).optional().describe("Tools that Gemini can auto-approve without confirmation (e.g., ['run_shell_command']). Use sparingly for security."),
});

export const brainstormTool: UnifiedTool = {
  name: "brainstorm",
  description: "Generate novel ideas with dynamic context gathering. --> Creative frameworks (SCAMPER, Design Thinking, etc.), domain context integration, idea clustering, feasibility analysis, and iterative refinement.",
  zodSchema: brainstormArgsSchema,
  prompt: {
    description: "Generate structured brainstorming prompt with methodology-driven ideation, domain context integration, and analytical evaluation framework",
  },
  category: 'gemini',
  execute: async (args, onProgress) => {
    const {
      prompt,
      session,
      model,
      methodology = 'auto',
      domain,
      constraints,
      existingContext,
      ideaCount = 12,
      includeAnalysis = true,
      includeHistory = true,
      allowedTools
    } = args;

    if (!prompt?.trim()) {
      throw new Error("You must provide a valid brainstorming challenge or question to explore");
    }

    // Session handling
    let sessionData = null;
    let contextualizedExistingContext = existingContext;

    if (session) {
      try {
        sessionData = await brainstormSessionManager.getOrCreate(
          session as string,
          prompt.trim() as string,
          methodology as string,
          domain as string | undefined,
          constraints as string | undefined
        );

        // Build context from previous rounds
        if (includeHistory && sessionData.rounds.length > 0) {
          const previousIdeas = brainstormSessionManager.buildIdeasContext(sessionData, true);
          contextualizedExistingContext = existingContext
            ? `${existingContext}\n\n${previousIdeas}`
            : previousIdeas;
        }

        onProgress?.(`🧠 Session '${session}' (Round ${sessionData.rounds.length + 1})`);
      } catch (error) {
        onProgress?.(`⚠️  Session loading failed: ${error instanceof Error ? error.message : String(error)}`);
        Logger.error(`Failed to load session '${session}': ${error}`);
        // Continue without session
      }
    }

    let enhancedPrompt = buildBrainstormPrompt({
      prompt: prompt.trim() as string,
      methodology: methodology as string,
      domain: domain as string | undefined,
      constraints: constraints as string | undefined,
      existingContext: contextualizedExistingContext as string | undefined,
      ideaCount: ideaCount as number,
      includeAnalysis: includeAnalysis as boolean
    });

    Logger.debug(`Brainstorm: Using methodology '${methodology}' for domain '${domain || 'general'}'`);

    // Report progress to user
    onProgress?.(`Generating ${ideaCount} ideas via ${methodology} methodology...`);

    // Execute with Gemini
    const result = await executeGeminiCLI(enhancedPrompt, model as string | undefined, false, false, onProgress, allowedTools as string[] | undefined);

    // Save to session if provided
    if (session && sessionData) {
      try {
        // Parse ideas from response (simple extraction)
        const ideas = parseIdeasFromResponse(result);
        brainstormSessionManager.addRound(sessionData, prompt as string, result, ideas);
        await brainstormSessionManager.save(sessionData);
        onProgress?.(`💾 Saved to session '${session}' (${sessionData.totalIdeas} total ideas, ${sessionData.activeIdeas} active)`);
      } catch (error) {
        onProgress?.(`⚠️  Session save failed: ${error instanceof Error ? error.message : String(error)}`);
        Logger.error(`Failed to save session '${session}': ${error}`);
        // Continue - result is still valid even if session save failed
      }
    }

    return result;
  }
};

/**
 * Parses ideas from Gemini's brainstorm response
 * Extracts idea names, descriptions, and scores
 */
function parseIdeasFromResponse(response: string): Array<{
  name: string;
  description: string;
  feasibility?: number;
  impact?: number;
  innovation?: number;
}> {
  const ideas: Array<any> = [];

  // Pattern: ### Idea [N]: [Name]
  const ideaPattern = /###\s+Idea\s+\d+:\s*(.+?)\n\*\*Description:\*\*\s*(.+?)(?=\n###|\n\*\*Feasibility|\n---|$)/gis;

  let match;
  while ((match = ideaPattern.exec(response)) !== null) {
    const name = match[1].trim();
    const description = match[2].trim();

    // Try to extract scores
    const feasibilityMatch = response.match(
      new RegExp(`${name}[\\s\\S]{0,300}\\*\\*Feasibility:\\*\\*\\s*(\\d+)`, 'i')
    );
    const impactMatch = response.match(
      new RegExp(`${name}[\\s\\S]{0,300}\\*\\*Impact:\\*\\*\\s*(\\d+)`, 'i')
    );
    const innovationMatch = response.match(
      new RegExp(`${name}[\\s\\S]{0,300}\\*\\*Innovation:\\*\\*\\s*(\\d+)`, 'i')
    );

    ideas.push({
      name,
      description,
      feasibility: feasibilityMatch ? parseInt(feasibilityMatch[1], 10) : undefined,
      impact: impactMatch ? parseInt(impactMatch[1], 10) : undefined,
      innovation: innovationMatch ? parseInt(innovationMatch[1], 10) : undefined
    });
  }

  return ideas;
}