import { spawn } from "child_process";
import { ZodSchema } from "zod";

const DEFAULT_TIMEOUT = 120_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3_000;

// Sequential queue — only one Claude CLI call at a time to avoid rate limits
let callQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = callQueue.then(fn, fn);
  callQueue = result.then(() => {}, () => {});
  return result;
}

/**
 * Call Claude Code CLI with a prompt via stdin, return raw text response.
 * Queued sequentially + retries on transient failures.
 */
export async function callClaude(
  prompt: string,
  options?: { timeout?: number; model?: string }
): Promise<string> {
  return enqueue(() => callClaudeWithRetry(prompt, options));
}

async function callClaudeWithRetry(
  prompt: string,
  options?: { timeout?: number; model?: string }
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[claude-cli] Retry ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms...`);
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      return await callClaudeOnce(prompt, { ...options, timeout });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message;

      // Don't retry on timeout — it won't get faster
      if (msg.includes("timed out")) throw lastError;

      // Retry on exit code 1 (transient CLI errors, rate limits)
      if (msg.includes("exited with code")) {
        console.error(`[claude-cli] Attempt ${attempt + 1} failed: ${msg.slice(0, 200)}`);
        continue;
      }

      // Don't retry on spawn errors (CLI not found, etc.)
      throw lastError;
    }
  }

  throw lastError ?? new Error("Claude CLI failed after retries");
}

function callClaudeOnce(
  prompt: string,
  options?: { timeout?: number; model?: string }
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const model = options?.model;

  return new Promise((resolve, reject) => {
    const args = ["--print"];
    if (model) {
      args.push("--model", model);
    }

    // Remove ANTHROPIC_API_KEY so CLI uses Max plan, not API credits
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`Claude CLI timed out after ${timeout}ms`));
      }
    }, timeout);

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        // Include both stderr AND stdout in error for diagnostics
        const errInfo = stderr.trim() || stdout.trim() || "(no output)";
        console.error(`[claude-cli] Exit code ${code}: ${errInfo.slice(0, 500)}`);
        reject(new Error(`Claude CLI exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Claude CLI spawn error: ${err.message}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * Call Claude Code CLI and parse response as JSON validated by Zod schema.
 * Retries once on parse failure.
 */
export async function callClaudeJSON<T>(
  prompt: string,
  schema: ZodSchema<T>,
  options?: { timeout?: number; model?: string }
): Promise<T> {
  const fullPrompt = `${prompt}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, no explanation.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callClaude(fullPrompt, options);

    const jsonStr = extractJSON(raw);

    try {
      const parsed = JSON.parse(jsonStr);
      return schema.parse(parsed);
    } catch {
      if (attempt === 1) {
        throw new Error(
          `Claude CLI JSON parse failed after 2 attempts. Raw: ${raw.slice(0, 500)}`
        );
      }
      continue;
    }
  }

  throw new Error("Unreachable");
}

/**
 * Extract JSON from a string that might contain markdown fences.
 */
function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  return text.trim();
}
