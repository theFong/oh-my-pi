import { beforeAll, describe, expect, it } from "bun:test";
import { Settings } from "../../../config/settings";
import type { AgentSession } from "../../../session/agent-session";
import { getThemeByName, setThemeInstance } from "../../theme/theme";
import { STATUS_LINE_PRESETS } from "./presets";
import { renderSegment, SEGMENTS } from "./segments";
import type { SegmentContext } from "./types";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	const loaded = await getThemeByName("dark");
	if (!loaded) throw new Error("theme unavailable");
	setThemeInstance(loaded);
});

/** Minimal `SegmentContext` seeded with the given `usageStats` tail. */
function ctxWithUsage(usageStats: Partial<SegmentContext["usageStats"]>): SegmentContext {
	return {
		session: { state: { model: undefined } } as unknown as AgentSession,
		activeRepo: null,
		width: 120,
		options: {},
		compactThinkingLevel: false,
		planMode: null,
		prewalk: null,
		loopMode: null,
		goalMode: null,
		vibeMode: null,
		collab: null,
		usageStats: {
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
			tokensPerSecond: null,
			...usageStats,
		},
		contextPercent: null,
		contextTokens: 0,
		contextWindow: 0,
		autoCompactEnabled: false,
		subagentCount: 0,
		activeMs: 0,
		git: { branch: null, status: null, pr: null },
		worktree: null,
		usage: null,
	};
}

describe("ttft status-line segment", () => {
	it("is registered in SEGMENTS", () => {
		expect(SEGMENTS.ttft).toBeDefined();
		expect(SEGMENTS.ttft.id).toBe("ttft");
	});

	it("renders formatDuration(ttftMs) when ttftMs is positive", () => {
		const rendered = renderSegment("ttft", ctxWithUsage({ ttftMs: 340 }));
		expect(rendered.visible).toBe(true);
		// 340ms → "340ms"; strip ANSI to assert the readout survives icon/color wrapping.
		expect(rendered.content).toContain("340ms");
	});

	it("rounds sub-millisecond TTFT to the nearest whole ms", () => {
		// Providers report fractional TTFT (e.g. 873.9155ms from vLLM); the
		// readout must not leak the float into the status line.
		const rendered = renderSegment("ttft", ctxWithUsage({ ttftMs: 873.9155 }));
		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("874ms");
		expect(rendered.content).not.toContain("873.9");
	});

	it("renders seconds-scale ttft with one-decimal precision", () => {
		const rendered = renderSegment("ttft", ctxWithUsage({ ttftMs: 1230 }));
		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("1.2s");
	});

	it("hides when ttftMs is null (provider did not report one)", () => {
		const rendered = renderSegment("ttft", ctxWithUsage({ ttftMs: null }));
		expect(rendered.visible).toBe(false);
		expect(rendered.content).toBe("");
	});

	it("hides when ttftMs is zero or negative", () => {
		expect(renderSegment("ttft", ctxWithUsage({ ttftMs: 0 })).visible).toBe(false);
		expect(renderSegment("ttft", ctxWithUsage({ ttftMs: -5 })).visible).toBe(false);
	});

	it("hides when ttftMs is undefined (field absent on legacy contexts)", () => {
		const rendered = renderSegment("ttft", ctxWithUsage({}));
		expect(rendered.visible).toBe(false);
	});
});

describe("token_rate status-line segment sparkline", () => {
	it("prepends a sparkline when at least two history samples exist", () => {
		const rendered = renderSegment(
			"token_rate",
			ctxWithUsage({ tokensPerSecond: 130, tokensPerSecondHistory: [100, 100, 100, 130] }),
		);
		expect(rendered.visible).toBe(true);
		// Sparkline bars are block glyphs; the readout follows them.
		expect(rendered.content).toMatch(/[▁▂▃▄▅▆▇█].*130\.0 tok\/s/);
	});

	it("omits the sparkline on the first turn (no history)", () => {
		const rendered = renderSegment("token_rate", ctxWithUsage({ tokensPerSecond: 119.4 }));
		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("119.4 tok/s");
		expect(rendered.content).not.toMatch(/[▁▂▃▄▅▆▇█]/);
	});

	it("omits the sparkline when only one sample exists (lone bar reads as noise)", () => {
		const rendered = renderSegment(
			"token_rate",
			ctxWithUsage({ tokensPerSecond: 100, tokensPerSecondHistory: [100] }),
		);
		expect(rendered.content).toContain("100.0 tok/s");
		expect(rendered.content).not.toMatch(/[▁▂▃▄▅▆▇█]/);
	});
});

describe("default status-line preset surfaces throughput + ttft", () => {
	it("includes token_rate and ttft in the default left segments", () => {
		const left = STATUS_LINE_PRESETS.default.leftSegments;
		expect(left).toContain("token_rate");
		expect(left).toContain("ttft");
	});

	it("keeps token_rate_spark + ttft together in the full preset", () => {
		const right = STATUS_LINE_PRESETS.full.rightSegments;
		expect(right).toContain("token_rate_spark");
		expect(right).toContain("ttft");
	});

	it("keeps token_rate_spark + ttft together in the nerd preset", () => {
		const right = STATUS_LINE_PRESETS.nerd.rightSegments;
		expect(right).toContain("token_rate_spark");
		expect(right).toContain("ttft");
	});
});
