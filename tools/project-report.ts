/**
 * project_report pi tool (#773) — the top of the discovery funnel:
 * project_report orients the agent in the project, module_report explains one
 * file, read_symbol reads the exact body. Thin wrapper over the existing
 * projectReport() engine seam (clients/lens-engine.ts), mirroring the MCP
 * pilens_project_report tool. Follows symbol_search's cold-cache contract
 * (#348 decision 3): a cold graph kicks off a background build and returns
 * `available: false` with a retry hint, never blocking the call.
 */

import { Type } from "../clients/deps/typebox.js";
import {
	projectReport,
	renderCompactProjectReport,
	type ProjectReport,
} from "../clients/lens-engine.js";
import { compactRenderResult } from "./render-compact.js";

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function createProjectReportTool(getProjectRoot: () => string) {
	return {
		name: "project_report" as const,
		label: "Project Report",
		description:
			"Cached review-graph orientation: trust/coverage, hubs, entry points, subsystems, cycles/layering, risk hotspots, and low-confidence dead-weight candidates. " +
			"Returns structural file-level facts; a cold cache returns unavailable and starts a background build.",
		promptSnippet: "Project-level orientation from the review graph",
		renderResult: compactRenderResult<{
			available?: boolean;
			hint?: string;
			hubs?: number;
			entryPoints?: number;
			view?: string;
		}>(({ details, isError }) => {
			if (isError || details?.available === false) {
				return `project_report — unavailable${details?.hint ? `: ${details.hint}` : ""}`;
			}
			const parts = [
				`${details?.hubs ?? 0} hub(s)`,
				`${details?.entryPoints ?? 0} entry point(s)`,
			];
			const view = details?.view && details.view !== "default" ? ` [${details.view}]` : "";
			return `project_report  ${parts.join(" · ")}${view}`;
		}),
		parameters: Type.Object({
			limit: Type.Optional(
				Type.Number({
					description:
						"Scales every ranked section's cap (default 10) — a single knob for all sections.",
				}),
			),
			focus: Type.Optional(
				Type.String({
					description:
						"Task hint for re-ranking only; does not expand scope or trigger scans.",
				}),
			),
			view: Type.Optional(
				Type.String({
					enum: ["default", "compact"],
					description:
						"default returns JSON; compact returns line-oriented text.",
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { limit?: number; focus?: string; view?: "default" | "compact" },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: { cwd?: string },
		) {
			const cwd = getProjectRoot() || ctx.cwd || ".";
			let report: ProjectReport;
			try {
				report = await projectReport(cwd, {
					limit: params.limit,
					focus: params.focus,
					view: params.view === "compact" ? "compact" : undefined,
				});
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Project report failed: ${errorMessage(err)}`,
						},
					],
					isError: true,
					details: { available: false },
				};
			}
			if (!report.available) {
				return {
					content: [
						{
							type: "text" as const,
							text: report.hint ?? "No review graph cached for this workspace yet.",
						},
					],
					isError: true,
					details: { available: false, hint: report.hint },
				};
			}
			const text =
				params.view === "compact"
					? renderCompactProjectReport(report)
					: JSON.stringify(report);
			return {
				content: [{ type: "text" as const, text }],
				details: {
					available: true,
					hubs: report.hubs?.length ?? 0,
					entryPoints: report.entryPoints?.length ?? 0,
					view: report.view ?? "default",
				},
			};
		},
	};
}
