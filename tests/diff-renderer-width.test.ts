import assert from "node:assert/strict";
import test from "node:test";
import { Box, visibleWidth, type Component } from "@mariozechner/pi-tui";
import { buildDiffSummaryText, resolveDiffPresentationMode } from "../src/diff-presentation.ts";
import { renderEditDiffResult, renderWriteDiffResult } from "../src/diff-renderer.ts";

const diffConfig = {
	diffViewMode: "auto",
	diffSplitMinWidth: 80,
	diffCollapsedLines: 24,
	diffWordWrap: true,
};

const theme = {
	fg: (_color: string, text: string): string => text,
	bold: (text: string): string => text,
};

interface RgbColor {
	r: number;
	g: number;
	b: number;
}

const ADDITION_TINT_TARGET: RgbColor = { r: 84, g: 190, b: 118 };
const DELETION_TINT_TARGET: RgbColor = { r: 232, g: 95, b: 122 };
const ADD_ROW_BACKGROUND_MIX_RATIO = 0.24;
const REMOVE_ROW_BACKGROUND_MIX_RATIO = 0.12;
const ADD_INLINE_EMPHASIS_MIX_RATIO = 0.44;

function mixRgb(base: RgbColor, tint: RgbColor, ratio: number): RgbColor {
	const clamped = Math.max(0, Math.min(1, ratio));
	return {
		r: base.r * (1 - clamped) + tint.r * clamped,
		g: base.g * (1 - clamped) + tint.g * clamped,
		b: base.b * (1 - clamped) + tint.b * clamped,
	};
}

function rgbToBgAnsi(color: RgbColor): string {
	return `\x1b[48;2;${Math.round(color.r)};${Math.round(color.g)};${Math.round(color.b)}m`;
}

function resolveInlineHighlightPalette(baseBg: RgbColor, addFg: RgbColor, removeFg: RgbColor): {
	addRowBg: string;
	removeRowBg: string;
	addEmphasisBg: string;
} {
	const addTint = mixRgb(addFg, ADDITION_TINT_TARGET, 0.35);
	const removeTint = mixRgb(removeFg, DELETION_TINT_TARGET, 0.65);
	return {
		addRowBg: rgbToBgAnsi(mixRgb(baseBg, addTint, ADD_ROW_BACKGROUND_MIX_RATIO)),
		removeRowBg: rgbToBgAnsi(mixRgb(baseBg, removeTint, REMOVE_ROW_BACKGROUND_MIX_RATIO)),
		addEmphasisBg: rgbToBgAnsi(mixRgb(baseBg, addTint, ADD_INLINE_EMPHASIS_MIX_RATIO)),
	};
}

function renderInsideToolBox(component: Component, width: number): string[] {
	const box = new Box(1, 1);
	box.addChild(component);
	return box.render(width);
}

function assertLinesFitWidth(lines: string[], width: number): void {
	for (const line of lines) {
		assert.ok(
			visibleWidth(line) <= width,
			`rendered line exceeded width ${width}: ${visibleWidth(line)} :: ${JSON.stringify(line)}`,
		);
	}
}

test("diff presentation mode progressively degrades for narrow widths", () => {
	assert.equal(resolveDiffPresentationMode(diffConfig, 120, true), "split");
	assert.equal(resolveDiffPresentationMode(diffConfig, 24, false), "unified");
	assert.equal(resolveDiffPresentationMode(diffConfig, 12, false), "compact");
	assert.equal(resolveDiffPresentationMode(diffConfig, 7, false), "summary");
});

test("diff summary text always fits the available width", () => {
	for (const width of [1, 4, 7, 12, 24]) {
		const summary = buildDiffSummaryText(
			{ added: 12, removed: 3, hunks: 2, files: 1 },
			width,
		);
		assert.ok(visibleWidth(summary) <= width);
	}
});

test("edit diff renderer respects parent box width across narrow layouts", () => {
	const component = renderEditDiffResult(
		{
			diff: "--- a/demo.txt\n+++ b/demo.txt\n@@ -1,2 +1,2 @@\n-old value\n+new value\n unchanged\n",
		},
		{ expanded: false, filePath: "demo.txt" },
		diffConfig as any,
		theme,
		"",
	);

	for (const width of [23, 17, 7]) {
		const lines = renderInsideToolBox(component, width);
		assertLinesFitWidth(lines, width);
		assert.ok(lines.some((line) => visibleWidth(line) > 0));
	}
});

test("write diff renderer respects parent box width across narrow layouts", () => {
	const component = renderWriteDiffResult(
		"hello world\nsecond line\n",
		{ expanded: false, filePath: "demo.txt", fileExistedBeforeWrite: false },
		diffConfig as any,
		theme,
		"",
	);

	for (const width of [23, 17, 7]) {
		const lines = renderInsideToolBox(component, width);
		assertLinesFitWidth(lines, width);
		assert.ok(lines.some((line) => visibleWidth(line) > 0));
	}
});

test("write overwrite diff renderer falls back when the overwrite matrix would be too large", () => {
	const previousContent = `${Array.from({ length: 1100 }, (_, index) => `old-${index}`).join("\n")}\n`;
	const nextContent = `${Array.from({ length: 1100 }, (_, index) => `new-${index}`).join("\n")}\n`;
	const component = renderWriteDiffResult(
		nextContent,
		{
			expanded: false,
			filePath: "demo.txt",
			fileExistedBeforeWrite: true,
			previousContent,
		},
		diffConfig as any,
		theme,
		"",
	);

	const lines = renderInsideToolBox(component, 80);
	assertLinesFitWidth(lines, 80);
	assert.match(lines.join("\n"), /overwrite diff omitted/i);
});

test("inline emphasis backgrounds remain visible while row backgrounds still recover after resets", () => {
	const baseBg = { r: 10, g: 20, b: 30 };
	const addFg = { r: 100, g: 150, b: 200 };
	const removeFg = { r: 200, g: 100, b: 120 };
	const palette = resolveInlineHighlightPalette(baseBg, addFg, removeFg);
	const splitDiffConfig = { ...diffConfig, diffViewMode: "split" };
	const ansiTheme = {
		fg: (_color: string, text: string): string => `\x1b[38;2;1;2;3m${text}\x1b[0m`,
		bold: (text: string): string => text,
		getFgAnsi: (slot: string): string | undefined => {
			if (slot === "toolDiffAdded") {
				return `\x1b[38;2;${addFg.r};${addFg.g};${addFg.b}m`;
			}
			if (slot === "toolDiffRemoved") {
				return `\x1b[38;2;${removeFg.r};${removeFg.g};${removeFg.b}m`;
			}
			return undefined;
		},
		getBgAnsi: (slot: string): string | undefined => {
			if (slot === "toolSuccessBg") {
				return `\x1b[48;2;${baseBg.r};${baseBg.g};${baseBg.b}m`;
			}
			return undefined;
		},
	};
	const component = renderEditDiffResult(
		{
			diff: "--- a/demo.txt\n+++ b/demo.txt\n@@ -1 +1 @@\n-keep before suffix\n+keep after suffix\n",
		},
		{ expanded: true, filePath: "demo.txt" },
		splitDiffConfig as any,
		ansiTheme,
		"",
	);

	const lines = renderInsideToolBox(component, 120);
	const addedLine = lines.find((line) => line.includes("after"));
	assert.ok(addedLine, "expected an added line containing the inline-emphasized text");
	assert.ok(
		addedLine.includes(`${palette.addEmphasisBg}after${palette.addRowBg}`),
		`expected inline emphasis background to remain active for the changed span: ${JSON.stringify(addedLine)}`,
	);
	assert.ok(
		!addedLine.includes(`${palette.addEmphasisBg}${palette.addRowBg}after`),
		`expected row background not to overwrite the inline emphasis span immediately: ${JSON.stringify(addedLine)}`,
	);
	const stabilizedResetAnsi = "\x1b[39;22;23;24;25;27;28;29;59m";
	assert.ok(
		addedLine.includes(`${stabilizedResetAnsi}${palette.addRowBg}`)
			|| addedLine.includes(`${stabilizedResetAnsi}${palette.removeRowBg}`),
		`expected row background to be restored after reset sequences: ${JSON.stringify(addedLine)}`,
	);
});
