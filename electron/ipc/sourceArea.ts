import type { AreaSelectionResult, CaptureArea, SelectedSource } from "./types";

/** Smallest area worth recording, in points. */
export const MIN_CAPTURE_AREA_SIZE = 32;

/**
 * Validates what an area-selector window reports. The rectangle must have a
 * usable size and lie on the display it was drawn on.
 */
export function normalizeAreaSelection(
	input: unknown,
	displays: Array<{ id: number; bounds: CaptureArea }>,
): AreaSelectionResult | null {
	if (!input || typeof input !== "object") return null;
	const candidate = input as Record<string, unknown>;
	const values = [
		candidate.x,
		candidate.y,
		candidate.width,
		candidate.height,
		candidate.displayId,
	];
	if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
		return null;
	}
	const display = displays.find((entry) => entry.id === candidate.displayId);
	if (!display) return null;

	const left = Math.max(display.bounds.x, Math.round(candidate.x as number));
	const top = Math.max(display.bounds.y, Math.round(candidate.y as number));
	const right = Math.min(
		display.bounds.x + display.bounds.width,
		Math.round((candidate.x as number) + (candidate.width as number)),
	);
	const bottom = Math.min(
		display.bounds.y + display.bounds.height,
		Math.round((candidate.y as number) + (candidate.height as number)),
	);
	if (right - left < MIN_CAPTURE_AREA_SIZE || bottom - top < MIN_CAPTURE_AREA_SIZE) {
		return null;
	}

	return {
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
		displayId: display.id,
		record: candidate.record === true,
	};
}

export function createAreaSource(selection: AreaSelectionResult): SelectedSource {
	return {
		id: `area:${selection.displayId}`,
		name: `Area ${selection.width}×${selection.height}`,
		display_id: String(selection.displayId),
		sourceType: "area",
		area: {
			x: selection.x,
			y: selection.y,
			width: selection.width,
			height: selection.height,
		},
	};
}

export function getSourceArea(source: SelectedSource | null | undefined): CaptureArea | null {
	if (!source?.id?.startsWith("area:") || !source.area) return null;
	const { x, y, width, height } = source.area;
	return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
		? { x, y, width, height }
		: null;
}
