import { beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { Settings } from "../../../config/settings";
import type { AgentSession } from "../../../session/agent-session";
import { getThemeByName, setThemeInstance } from "../../theme/theme";
import { StatusLineComponent } from "./component";
import type { StatusLineSettings } from "./types";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	const loaded = await getThemeByName("dark");
	if (!loaded) throw new Error("theme unavailable");
	setThemeInstance(loaded);
});

/**
 * Build a mock AgentSession with a sequence of assistant turns whose
 * `timestamp` / `duration` / `usage.output` / `ttft` produce realistic tok/s
 * and TTFT values. The mock satisfies the fields `#buildSegmentContext` and
 * the `token_rate`/`ttft` segments actually read.
 */
function makeSession(messages: unknown[]): AgentSession {
	return {
		state: { model: undefined, tools: [], messages },
		messages,
		isStreaming: false,
		model: { contextWindow: 128000 },
		contextUsageRevision: 0,
		systemPrompt: [],
		agent: { state: { tools: [] } },
		skills: [],
		sessionManager: {
			getUsageStatistics: () => ({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				orchestrationInput: 0,
				orchestrationOutput: 0,
				orchestrationCacheRead: 0,
				premiumRequests: 0,
				cost: 0,
			}),
		},
		modelRegistry: {
			isUsingOAuth: () => false,
			authStorage: undefined,
		},
		isFastModeActive: () => false,
		isAdvisorActive: () => false,
		thinkingLevel: undefined,
		getProjectDir: () => "/tmp",
		sessionId: "test",
		getAsyncJobSnapshot: () => ({ running: [] }),
		getContextUsage: () => ({ tokens: 42, contextWindow: 128000, percent: 0 }),
	} as unknown as AgentSession;
}

/** One assistant turn: `output` tokens over `durationMs`, `ttftMs` to first token.
 *  tok/s = output / durationMs * 1000. */
function assistantTurn(ts: number, output: number, durationMs: number, ttftMs: number) {
	return { role: "assistant", timestamp: ts, duration: durationMs, usage: { output }, ttft: ttftMs };
}
const MINIMAL_PRESET: StatusLineSettings = {
	preset: "custom",
	leftSegments: ["token_rate", "ttft"],
	rightSegments: [],
	separator: "pipe",
	segmentOptions: {},
};

describe("StatusLineComponent tok/s + ttft end-to-end", () => {
	it("accumulates tok/s samples across turns and renders a sparkline", () => {
		// Simulate a live session: turns arrive one at a time, each followed by
		// a render. #getTokensPerSecond records one sample per render (keyed by
		// the latest assistant timestamp), so the history grows across renders
		// exactly as it does in the TUI.
		const messages: unknown[] = [];
		const statusLine = new StatusLineComponent(makeSession(messages));
		statusLine.updateSettings(MINIMAL_PRESET);

		// Three steady turns at 100 tok/s (output=200, duration=2000ms).
		for (let i = 0; i < 3; i++) {
			messages.push(assistantTurn(1_000 + i * 4_000, 200, 2_000, 1_000));
			statusLine.getTopBorder(200);
		}
		// Fourth turn at 130 tok/s (output=260) — the sparkline's peak bar rises.
		messages.push(assistantTurn(13_000, 260, 2_000, 1_000));
		const plain = stripVTControlCharacters(statusLine.getTopBorder(200).content);

		expect(plain).toContain("130.0 tok/s");
		// Sparkline bars precede the readout once ≥2 samples exist.
		expect(plain).toMatch(/[▁▂▃▄▅▆▇█].*130\.0 tok\/s/);
	});

	it("omits the sparkline on the first turn (no history yet)", () => {
		const messages: unknown[] = [assistantTurn(1_000, 200, 2_000, 1_000)];
		const statusLine = new StatusLineComponent(makeSession(messages));
		statusLine.updateSettings(MINIMAL_PRESET);
		const plain = stripVTControlCharacters(statusLine.getTopBorder(200).content);
		expect(plain).toContain("100.0 tok/s");
		// No sparkline bars until the second turn completes.
		expect(plain).not.toMatch(/[▁▂▃▄▅▆▇█]/);
	});

	it("renders the ttft segment with the last turn's rounded TTFT", () => {
		const messages = [assistantTurn(1_000, 100, 2_000, 873.9155)];
		const statusLine = new StatusLineComponent(makeSession(messages));
		statusLine.updateSettings(MINIMAL_PRESET);
		const plain = stripVTControlCharacters(statusLine.getTopBorder(200).content);
		expect(plain).toContain("874ms");
		expect(plain).not.toContain("873.9");
	});
});
