import { describe, expect, it } from "vitest";
import { createAreaSource, getSourceArea, normalizeAreaSelection } from "./sourceArea";

const displays = [
	{ id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1117 } },
	{ id: 2, bounds: { x: 1728, y: -200, width: 2560, height: 1440 } },
];

describe("normalizeAreaSelection", () => {
	it("keeps an area that lies on its display", () => {
		expect(
			normalizeAreaSelection(
				{ x: 100.4, y: 50, width: 1280, height: 720, displayId: 1, record: true },
				displays,
			),
		).toEqual({ x: 100, y: 50, width: 1280, height: 720, displayId: 1, record: true });
	});

	it("clips an area to its display, including displays left of or above the origin", () => {
		expect(
			normalizeAreaSelection(
				{ x: 1700, y: -300, width: 400, height: 400, displayId: 2, record: false },
				displays,
			),
		).toEqual({ x: 1728, y: -200, width: 372, height: 300, displayId: 2, record: false });
	});

	it("rejects areas that are too small, unknown displays and malformed input", () => {
		const area = { x: 0, y: 0, width: 20, height: 400, displayId: 1, record: true };
		expect(normalizeAreaSelection(area, displays)).toBeNull();
		expect(normalizeAreaSelection({ ...area, width: 400, displayId: 9 }, displays)).toBeNull();
		expect(normalizeAreaSelection({ ...area, width: "400" }, displays)).toBeNull();
		expect(normalizeAreaSelection(null, displays)).toBeNull();
	});
});

describe("area sources", () => {
	it("round-trips the recorded rectangle", () => {
		const source = createAreaSource({
			x: 10,
			y: 20,
			width: 640,
			height: 480,
			displayId: 1,
			record: false,
		});
		expect(source).toMatchObject({ id: "area:1", name: "Area 640×480", display_id: "1" });
		expect(getSourceArea(source)).toEqual({ x: 10, y: 20, width: 640, height: 480 });
	});

	it("ignores sources that are not areas", () => {
		expect(getSourceArea({ id: "screen:1:0", name: "Screen" })).toBeNull();
		expect(getSourceArea(null)).toBeNull();
	});
});
