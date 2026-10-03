import { ipcMain } from "electron";
import { closeAreaSelectorWindows, createAreaSelectorWindows } from "../../windows";
import { stopWindowBoundsCapture } from "../cursor/bounds";
import { setSelectedSource } from "../state";
import { createAreaSource, normalizeAreaSelection } from "../sourceArea";
import type { AreaSelectionResult } from "../types";
import { getScreen } from "../utils";
import { broadcastSelectedSourceChange } from "./sources";

export function registerAreaHandlers() {
	let resolvePendingSelection: ((selection: AreaSelectionResult | null) => void) | null = null;
	let lastSelection: AreaSelectionResult | null = null;

	const finishSelection = (selection: AreaSelectionResult | null) => {
		const resolve = resolvePendingSelection;
		resolvePendingSelection = null;
		resolve?.(selection);
	};

	ipcMain.handle("select-area", async () => {
		if (process.platform !== "darwin") {
			return { success: false, message: "Recording an area is available on macOS." };
		}

		finishSelection(null);
		const selection = await new Promise<AreaSelectionResult | null>((resolve) => {
			resolvePendingSelection = resolve;
			// Closing an overlay without confirming cancels the selection.
			createAreaSelectorWindows(() => finishSelection(null));
		});
		closeAreaSelectorWindows();
		if (!selection) {
			return { success: false, canceled: true };
		}

		lastSelection = selection;
		const source = createAreaSource(selection);
		setSelectedSource(source);
		broadcastSelectedSourceChange();
		stopWindowBoundsCapture();
		return { success: true, source, record: selection.record };
	});

	ipcMain.handle("complete-area-selection", (_, input: unknown) => {
		finishSelection(
			input
				? normalizeAreaSelection(
						input,
						getScreen()
							.getAllDisplays()
							.map((display) => ({ id: display.id, bounds: display.bounds })),
					)
				: null,
		);
	});

	ipcMain.handle("get-area-selector-context", (_, displayId: unknown) => {
		const display = getScreen()
			.getAllDisplays()
			.find((entry) => entry.id === Number(displayId));
		const previous =
			lastSelection && lastSelection.displayId === display?.id ? lastSelection : null;
		return {
			displayBounds: display?.bounds ?? null,
			lastArea: previous
				? {
						x: previous.x,
						y: previous.y,
						width: previous.width,
						height: previous.height,
					}
				: null,
		};
	});
}
