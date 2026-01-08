# gemini-mcp-tool-windows-fixed

Windows-compatible fork of [@maxanatsko/gemini-mcp-tool](https://github.com/maxanatsko/gemini-mcp-tool).

## Fixes Applied

### 1. ENOENT on Windows
**Problem**: `spawn('gemini', ...)` fails on Windows because `gemini` is installed as `gemini.cmd` (npm wrapper), which requires a shell to execute.

**Fix**: `commandExecutor.ts` line 16
```typescript
// Before
shell: false

// After
shell: process.platform === 'win32'
```

### 2. Deprecated `-p` Flag
**Problem**: Gemini CLI v0.23.0+ deprecated the `-p`/`--prompt` flag in favor of positional arguments.

**Fix**: `geminiExecutor.ts` lines 106 and 133
```typescript
// Before
args.push(CLI.FLAGS.PROMPT, finalPrompt);

// After
args.push(finalPrompt);
```

## Installation

### Option 1: Local (Recommended)
```bash
git clone https://github.com/samuelgudi/gemini-mcp-tool-windows-fixed.git
cd gemini-mcp-tool-windows-fixed
npm install && npm run build
```

Configure MCP:
```bash
claude mcp add gemini-cli -- node /path/to/gemini-mcp-tool-windows-fixed/dist/index.js
```

### Option 2: From GitHub via npx
```bash
claude mcp add gemini-cli -- npx github:samuelgudi/gemini-mcp-tool-windows-fixed
```

## Prerequisites

- Gemini CLI installed and authenticated: `npm install -g @google/gemini-cli && gemini auth login`
- Node.js >= 16.0.0

## Available Tools

| Tool | Description |
|------|-------------|
| `ask-gemini` | Query Gemini with `@` file references |
| `brainstorm` | Ideation with creative frameworks |
| `review-code` | Interactive code review sessions |

## Credits

Original package by [@maxanatsko](https://github.com/maxanatsko/gemini-mcp-tool).
Windows fixes by [@samuelgudi](https://github.com/samuelgudi).

## License

MIT
