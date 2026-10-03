import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import {
	type AreaRect,
	type AreaHandle,
	AREA_HANDLES,
	MIN_AREA_SIZE,
	moveAreaRect,
	normalizeAreaRect,
	resizeAreaRect,
} from "./areaGeometry";

type Drag =
	| { kind: "draw"; originX: number; originY: number }
	| { kind: "move"; startX: number; startY: number; rect: AreaRect }
	| { kind: "resize"; handle: AreaHandle; startX: number; startY: number; rect: AreaRect };

function viewport() {
	return { width: window.innerWidth, height: window.innerHeight };
}

const TOOLBAR_HEIGHT = 44;
const TOOLBAR_GAP = 12;

const HANDLE_POSITIONS: Record<AreaHandle, { left: string; top: string; cursor: string }> = {
	nw: { left: "0%", top: "0%", cursor: "nwse-resize" },
	n: { left: "50%", top: "0%", cursor: "ns-resize" },
	ne: { left: "100%", top: "0%", cursor: "nesw-resize" },
	e: { left: "100%", top: "50%", cursor: "ew-resize" },
	se: { left: "100%", top: "100%", cursor: "nwse-resize" },
	s: { left: "50%", top: "100%", cursor: "ns-resize" },
	sw: { left: "0%", top: "100%", cursor: "nesw-resize" },
	w: { left: "0%", top: "50%", cursor: "ew-resize" },
};

/**
 * Full-display overlay for drawing the area to record, one per display. Drag to
 * draw, drag inside to move, drag a handle to resize. Enter or double-click
 * records, Escape cancels.
 */
export function AreaSelector() {
	const t = useScopedT("launch");
	const [displayId] = useState(() =>
		Number(new URLSearchParams(window.location.search).get("displayId")),
	);
	const [rect, setRect] = useState<AreaRect | null>(null);
	const [dragging, setDragging] = useState(false);
	const dragRef = useRef<Drag | null>(null);
	const rectRef = useRef<AreaRect | null>(null);
	rectRef.current = rect;

	useEffect(() => {
		let cancelled = false;
		void window.electronAPI.getAreaSelectorContext(displayId).then((context) => {
			if (cancelled || !context.lastArea || rectRef.current) return;
			// The last area comes back in global points; the overlay starts at the display.
			setRect(
				normalizeAreaRect(
					{
						x: context.lastArea.x - window.screenX,
						y: context.lastArea.y - window.screenY,
						width: context.lastArea.width,
						height: context.lastArea.height,
					},
					viewport(),
				),
			);
		});
		return () => {
			cancelled = true;
		};
	}, [displayId]);

	const finish = useCallback(
		(record: boolean | null) => {
			const current = rectRef.current;
			if (record === null || !current) {
				void window.electronAPI.completeAreaSelection(null);
				return;
			}
			if (current.width < MIN_AREA_SIZE || current.height < MIN_AREA_SIZE) return;
			void window.electronAPI.completeAreaSelection({
				x: window.screenX + current.x,
				y: window.screenY + current.y,
				width: current.width,
				height: current.height,
				displayId,
				record,
			});
		},
		[displayId],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				finish(null);
			} else if (event.key === "Enter") {
				event.preventDefault();
				finish(true);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [finish]);

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		const target = event.target as HTMLElement;
		if (target.closest("[data-area-toolbar]")) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		const handle = target.closest<HTMLElement>("[data-area-handle]")?.dataset.areaHandle as
			| AreaHandle
			| undefined;
		const current = rectRef.current;
		if (handle && current) {
			dragRef.current = {
				kind: "resize",
				handle,
				startX: event.clientX,
				startY: event.clientY,
				rect: current,
			};
		} else if (target.closest("[data-area-selection]") && current) {
			dragRef.current = {
				kind: "move",
				startX: event.clientX,
				startY: event.clientY,
				rect: current,
			};
		} else {
			dragRef.current = { kind: "draw", originX: event.clientX, originY: event.clientY };
			setRect(null);
		}
		setDragging(true);
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		const bounds = viewport();
		if (drag.kind === "draw") {
			setRect(
				normalizeAreaRect(
					{
						x: drag.originX,
						y: drag.originY,
						width: event.clientX - drag.originX,
						height: event.clientY - drag.originY,
					},
					bounds,
				),
			);
		} else if (drag.kind === "move") {
			setRect(
				moveAreaRect(
					drag.rect,
					event.clientX - drag.startX,
					event.clientY - drag.startY,
					bounds,
				),
			);
		} else {
			setRect(
				resizeAreaRect(
					drag.rect,
					drag.handle,
					event.clientX - drag.startX,
					event.clientY - drag.startY,
					bounds,
				),
			);
		}
	};

	const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const drag = dragRef.current;
		dragRef.current = null;
		setDragging(false);
		const current = rectRef.current;
		if (drag?.kind === "draw" && current && (current.width < 4 || current.height < 4)) {
			setRect(null);
		}
	};

	const tooSmall = rect !== null && (rect.width < MIN_AREA_SIZE || rect.height < MIN_AREA_SIZE);
	const toolbarTop = rect
		? rect.y + rect.height + TOOLBAR_GAP + TOOLBAR_HEIGHT <= window.innerHeight
			? rect.y + rect.height + TOOLBAR_GAP
			: rect.y - TOOLBAR_GAP - TOOLBAR_HEIGHT >= 0
				? rect.y - TOOLBAR_GAP - TOOLBAR_HEIGHT
				: rect.y + rect.height - TOOLBAR_HEIGHT - TOOLBAR_GAP
		: 0;
	const labelAbove = rect !== null && rect.y >= 30;

	return (
		<div
			className="fixed inset-0 select-none"
			style={{ cursor: "crosshair", background: rect ? "transparent" : "rgba(0,0,0,0.38)" }}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			onDoubleClick={(event) => {
				if ((event.target as HTMLElement).closest("[data-area-selection]")) finish(true);
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				finish(null);
			}}
		>
			{rect === null ? (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="rounded-full bg-[rgba(18,18,22,0.88)] px-4 py-2 text-[13px] font-medium text-white/90 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
						{t(
							"areaSelector.hint",
							"Drag to select the area to record · Esc to cancel",
						)}
					</div>
				</div>
			) : (
				<>
					<div
						data-area-selection
						className="absolute"
						style={{
							left: rect.x,
							top: rect.y,
							width: rect.width,
							height: rect.height,
							cursor: dragging ? "grabbing" : "move",
							boxShadow: "0 0 0 100vmax rgba(0,0,0,0.38)",
							outline: "1px solid rgba(255,255,255,0.95)",
						}}
					>
						{AREA_HANDLES.map((handle) => (
							<div
								key={handle}
								data-area-handle={handle}
								className="absolute h-[11px] w-[11px] rounded-full border border-black/30 bg-white shadow"
								style={{
									left: HANDLE_POSITIONS[handle].left,
									top: HANDLE_POSITIONS[handle].top,
									transform: "translate(-50%, -50%)",
									cursor: HANDLE_POSITIONS[handle].cursor,
								}}
							/>
						))}
						<div
							className="pointer-events-none absolute left-0 whitespace-nowrap rounded-md bg-[rgba(18,18,22,0.88)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-white/90"
							style={labelAbove ? { top: -26 } : { top: 6, left: 6 }}
						>
							{Math.round(rect.width)} × {Math.round(rect.height)}
						</div>
					</div>
					{!dragging && (
						<div
							data-area-toolbar
							className="absolute flex items-center gap-1 rounded-full bg-[rgba(18,18,22,0.92)] p-1 text-[13px] font-medium text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md"
							style={{
								top: toolbarTop,
								left: rect.x + rect.width / 2,
								height: TOOLBAR_HEIGHT,
								transform: "translateX(-50%)",
								cursor: "default",
							}}
						>
							<button
								type="button"
								className="h-full rounded-full px-4 text-white/80 hover:bg-white/10 hover:text-white"
								onClick={() => finish(null)}
							>
								{t("areaSelector.cancel", "Cancel")}
							</button>
							<button
								type="button"
								disabled={tooSmall}
								className="h-full rounded-full px-4 text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40"
								onClick={() => finish(false)}
							>
								{t("areaSelector.select", "Set Area")}
							</button>
							<button
								type="button"
								disabled={tooSmall}
								className="flex h-full items-center gap-2 rounded-full bg-[#e5484d] px-4 text-white hover:bg-[#ec5d62] disabled:opacity-40"
								onClick={() => finish(true)}
							>
								<span className="h-2.5 w-2.5 rounded-full bg-white" />
								{t("areaSelector.record", "Record")}
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}

export default AreaSelector;
