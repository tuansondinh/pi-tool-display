import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerToolDisplayOverrides } from "../src/tool-overrides.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG, type ToolDisplayConfig } from "../src/types.ts";

interface RegisteredToolLike {
	name: string;
	renderResult?: (result: unknown, options: unknown, theme: unknown) => {
		render(width: number): string[];
	};
}

interface ToolEventHandlers {
	session_start?: () => Promise<void> | void;
	before_agent_start?: () => Promise<void> | void;
}

function buildConfig(overrides: Partial<ToolDisplayConfig>): ToolDisplayConfig {
	return {
		...DEFAULT_TOOL_DISPLAY_CONFIG,
		...overrides,
		registerToolOverrides: {
			...DEFAULT_TOOL_DISPLAY_CONFIG.registerToolOverrides,
			...overrides.registerToolOverrides,
		},
	};
}

function createExtensionApiStub(allTools: unknown[] = []): {
	api: ExtensionAPI;
	registeredTools: RegisteredToolLike[];
	eventHandlers: ToolEventHandlers;
} {
	const registeredTools: RegisteredToolLike[] = [];
	const eventHandlers: ToolEventHandlers = {};
	const api = {
		registerTool(tool: RegisteredToolLike): void {
			registeredTools.push(tool);
		},
		on(event: keyof ToolEventHandlers, handler: () => Promise<void> | void): void {
			eventHandlers[event] = handler;
		},
		getAllTools(): unknown[] {
			return allTools;
		},
	} as unknown as ExtensionAPI;

	return { api, registeredTools, eventHandlers };
}

function renderToolResult(
	tool: RegisteredToolLike | undefined,
	input: string | { text: string; details?: unknown; expanded?: boolean; isPartial?: boolean },
): string {
	assert.ok(tool?.renderResult, `expected renderResult for tool '${tool?.name ?? "unknown"}'`);
	const theme = {
		fg: (_color: string, value: string): string => value,
		bold: (value: string): string => value,
	};
	const payload = typeof input === "string" ? { text: input } : input;
	return tool.renderResult(
		{ content: [{ type: "text", text: payload.text }], details: payload.details ?? {} },
		{ isPartial: payload.isPartial ?? false, expanded: payload.expanded ?? false },
		theme,
	)
		.render(120)
		.join("\n")
		.trim();
}

test("current local-style config keeps read/search/MCP output modes distinct", async () => {
	const config = buildConfig({
		readOutputMode: "summary",
		searchOutputMode: "count",
		mcpOutputMode: "summary",
	});
	const { api, registeredTools, eventHandlers } = createExtensionApiStub([
		{
			name: "mcp",
			description: "Unified MCP gateway for status, discovery, reconnects, and proxy tool calls.",
			parameters: {},
			execute(): void {
				// No-op test stub.
			},
		},
	]);

	registerToolDisplayOverrides(api, () => config);
	await eventHandlers.session_start?.();

	const registeredNames = new Set(registeredTools.map((tool) => tool.name));
	assert.ok(registeredNames.has("read"));
	assert.ok(registeredNames.has("grep"));
	assert.ok(registeredNames.has("find"));
	assert.ok(registeredNames.has("ls"));
	assert.ok(registeredNames.has("bash"));
	assert.ok(registeredNames.has("edit"));
	assert.ok(registeredNames.has("write"));
	assert.ok(registeredNames.has("mcp"));

	assert.equal(
		renderToolResult(registeredTools.find((tool) => tool.name === "read"), "alpha\nbeta\n"),
		"↳ loaded 2 lines",
	);
	assert.equal(
		renderToolResult(registeredTools.find((tool) => tool.name === "grep"), "a.txt:1\nb.txt:2\n"),
		"↳ 2 matches returned",
	);
	assert.equal(
		renderToolResult(registeredTools.find((tool) => tool.name === "find"), "a.txt\nb.txt\n"),
		"↳ 2 results returned",
	);
	assert.equal(
		renderToolResult(registeredTools.find((tool) => tool.name === "ls"), "a.txt\nb.txt\n"),
		"↳ 2 entries returned",
	);
	assert.equal(
		renderToolResult(registeredTools.find((tool) => tool.name === "mcp"), "one\ntwo\n"),
		"↳ 2 lines returned",
	);
});

test("read-only ownership keeps summary line counts confined to read", () => {
	const config = buildConfig({
		registerToolOverrides: {
			read: true,
			grep: false,
			find: false,
			ls: false,
			bash: false,
			edit: false,
			write: false,
		},
		readOutputMode: "summary",
	});
	const { api, registeredTools } = createExtensionApiStub();

	registerToolDisplayOverrides(api, () => config);

	assert.deepEqual(
		registeredTools.map((tool) => tool.name),
		["read"],
	);
	assert.equal(
		renderToolResult(registeredTools[0], "single line\n"),
		"↳ loaded 1 line",
	);
});

test("showTruncationHints=false suppresses backend truncation summaries across read/search/MCP modes", async () => {
	const config = buildConfig({
		readOutputMode: "summary",
		searchOutputMode: "count",
		mcpOutputMode: "summary",
		showTruncationHints: false,
	});
	const { api, registeredTools, eventHandlers } = createExtensionApiStub([
		{
			name: "mcp",
			description: "Unified MCP gateway for status, discovery, reconnects, and proxy tool calls.",
			parameters: {},
			execute(): void {
				// No-op test stub.
			},
		},
	]);

	registerToolDisplayOverrides(api, () => config);
	await eventHandlers.session_start?.();

	assert.equal(
		renderToolResult(registeredTools.find((tool) => tool.name === "read"), {
			text: "alpha\n",
			details: { truncation: { truncated: true } },
		}),
		"↳ loaded 1 line",
	);
	assert.equal(
		renderToolResult(registeredTools.find((tool) => tool.name === "grep"), {
			text: "a.txt:1\n",
			details: { truncation: { truncated: true } },
		}),
		"↳ 1 match returned",
	);
	assert.equal(
		renderToolResult(registeredTools.find((tool) => tool.name === "mcp"), {
			text: "alpha\n",
			details: { truncation: { truncated: true } },
		}),
		"↳ 1 line returned",
	);
});

test("showRtkCompactionHints stays independent from showTruncationHints for summary modes", async () => {
	const config = buildConfig({
		readOutputMode: "summary",
		searchOutputMode: "count",
		mcpOutputMode: "summary",
		showTruncationHints: false,
		showRtkCompactionHints: true,
	});
	const { api, registeredTools, eventHandlers } = createExtensionApiStub([
		{
			name: "mcp",
			description: "Unified MCP gateway for status, discovery, reconnects, and proxy tool calls.",
			parameters: {},
			execute(): void {
				// No-op test stub.
			},
		},
	]);
	const rtkDetails = {
		rtkCompaction: {
			applied: true,
			techniques: ["trimmed context"],
		},
	};

	registerToolDisplayOverrides(api, () => config);
	await eventHandlers.session_start?.();

	assert.match(
		renderToolResult(registeredTools.find((tool) => tool.name === "read"), {
			text: "alpha\n",
			details: rtkDetails,
		}),
		/compacted by RTK • trimmed context/,
	);
	assert.match(
		renderToolResult(registeredTools.find((tool) => tool.name === "grep"), {
			text: "a.txt:1\n",
			details: rtkDetails,
		}),
		/compacted by RTK • trimmed context/,
	);
	assert.match(
		renderToolResult(registeredTools.find((tool) => tool.name === "mcp"), {
			text: "alpha\n",
			details: rtkDetails,
		}),
		/compacted by RTK • trimmed context/,
	);
});

test("showRtkCompactionHints stays independent from showTruncationHints for preview modes", async () => {
	const config = buildConfig({
		readOutputMode: "preview",
		searchOutputMode: "preview",
		mcpOutputMode: "preview",
		previewLines: 1,
		showTruncationHints: false,
		showRtkCompactionHints: true,
	});
	const { api, registeredTools, eventHandlers } = createExtensionApiStub([
		{
			name: "mcp",
			description: "Unified MCP gateway for status, discovery, reconnects, and proxy tool calls.",
			parameters: {},
			execute(): void {
				// No-op test stub.
			},
		},
	]);
	const rtkDetails = {
		rtkCompaction: {
			applied: true,
			techniques: ["trimmed context"],
			originalLineCount: 10,
			compactedLineCount: 1,
		},
	};

	registerToolDisplayOverrides(api, () => config);
	await eventHandlers.session_start?.();

	assert.match(
		renderToolResult(registeredTools.find((tool) => tool.name === "read"), {
			text: "alpha\nbeta\n",
			details: rtkDetails,
		}),
		/compacted by RTK: trimmed context • 1\/10 lines kept/,
	);
	assert.match(
		renderToolResult(registeredTools.find((tool) => tool.name === "grep"), {
			text: "a.txt:1\nb.txt:2\n",
			details: rtkDetails,
		}),
		/compacted by RTK: trimmed context • 1\/10 lines kept/,
	);
	assert.match(
		renderToolResult(registeredTools.find((tool) => tool.name === "mcp"), {
			text: "alpha\nbeta\n",
			details: rtkDetails,
		}),
		/compacted by RTK: trimmed context • 1\/10 lines kept/,
	);
});
