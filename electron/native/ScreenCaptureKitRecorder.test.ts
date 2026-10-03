import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const recorderSource = readFileSync(
	fileURLToPath(new URL("./ScreenCaptureKitRecorder.swift", import.meta.url)),
	"utf8",
);

describe("ScreenCaptureKitRecorder finalization coordination", () => {
	it("finalizes on parent pipe closure as well as an explicit stop, exactly once", () => {
		const commandLoop = recorderSource.slice(
			recorderSource.indexOf("while let input = readLine"),
		);
		expect(commandLoop).toMatch(
			/if input == "stop"\s*\{\s*break\s*\}\s*\}\s*\/\/.*?service\.stop\(\)/s,
		);
		expect(commandLoop.match(/service\.stop\(\)/g)).toHaveLength(1);
	});

	it("marks manual stops as participants in the shared finalization", () => {
		expect(recorderSource).toContain("finalizeCapture(interactive: true)");
		expect(recorderSource).toContain("finalization.outputResult.get()");
		expect(recorderSource).toContain(
			"self.interactiveStopParticipated = self.interactiveStopParticipated || interactive",
		);
	});

	it("does not let automatic window-close exit preempt a joined manual stop", () => {
		expect(recorderSource).toContain("self.finalizeCapture(interactive: false)");
		expect(recorderSource).toMatch(
			/if finalization\.interactiveStopParticipated\s*\{\s*return\s*\}/,
		);
	});
});

describe("ScreenCaptureKitRecorder timeline", () => {
	it("resumes on the host clock so speech after the countdown is kept", () => {
		expect(recorderSource).toContain("func resume(atHostTime hostTime: CMTime)");
		expect(recorderSource).toContain(
			"self.clock.resume(atHostTime: RecordingClock.hostTime())",
		);
		expect(recorderSource).not.toContain("pendingResumeAdjustment");
	});

	it("drops non-monotonic video frames", () => {
		expect(recorderSource).toContain(
			"CMTimeCompare(presentationTime, lastVideoPresentationTime) <= 0",
		);
	});

	it("holds the last frame until the stop instead of ending at the last change", () => {
		expect(recorderSource).toContain("private func appendStillFrameIfIdle()");
		expect(recorderSource).toContain("finalEndTime - tailDuration");
		expect(recorderSource).toContain("assetWriter.endSession(atSourceTime: finalEndTime)");
	});

	it("writes the frame that arrived before the writer was ready", () => {
		expect(recorderSource).toContain("pendingFirstFrame = sampleBuffer");
		expect(recorderSource).toContain("self.appendPendingFirstFrame(attemptsRemaining:");
	});
});

describe("ScreenCaptureKitRecorder audio", () => {
	const track = recorderSource.slice(
		recorderSource.indexOf("final class AudioTimelineTrack"),
		recorderSource.indexOf("final class ScreenCaptureRecorder"),
	);

	it("delivers audio on its own queue, never behind video work", () => {
		expect(recorderSource).toContain(
			"try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)",
		);
		expect(recorderSource).toContain(
			"try stream.addStreamOutput(self, type: microphoneOutputType, sampleHandlerQueue: audioQueue)",
		);
	});

	it("never drops a buffer because an encoder is busy", () => {
		expect(track).toContain("try sidecar.write(from: buffer)");
		expect(track).toContain("pendingInline.append(sampleBuffer)");
		expect(track).not.toMatch(/isReadyForMoreMediaData else \{\s*return/);
	});

	it("fills delivery gaps with silence and trims overlap", () => {
		expect(track).toContain("writeSilence(frames: limited(drift))");
		expect(track).toContain("skipFrames = min(-drift, Int64(converted.frameLength))");
		expect(recorderSource).toContain("track.finish(padTo: endFrame)");
	});
});

describe("ScreenCaptureKitRecorder colour metadata", () => {
	it("asks ScreenCaptureKit for BT.709-compatible video-range frames", () => {
		expect(recorderSource).toContain(
			"streamConfig.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange",
		);
		expect(recorderSource).toContain("streamConfig.colorSpaceName = CGColorSpace.sRGB");
		expect(recorderSource).toContain(
			"streamConfig.colorMatrix = CGDisplayStream.yCbCrMatrix_ITU_R_709_2",
		);
		expect(recorderSource).toContain("kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange");
		expect(recorderSource).toContain("sourceFormatHint: sourceVideoFormat");
		expect(recorderSource).not.toContain("videoCodecType: .h264");
	});

	it("tags recordings as BT.709", () => {
		expect(recorderSource).toContain("AVVideoColorPropertiesKey");
		expect(recorderSource).toContain("AVVideoColorPrimaries_ITU_R_709_2");
		expect(recorderSource).toContain("AVVideoTransferFunction_ITU_R_709_2");
		expect(recorderSource).toContain("AVVideoYCbCrMatrix_ITU_R_709_2");
	});
});

describe("ScreenCaptureKitRecorder window and area capture", () => {
	it("crops the display natively to the selected window bounds", () => {
		expect(recorderSource).not.toContain("desktopIndependentWindow");
		expect(recorderSource).not.toContain("CIContext");
		expect(recorderSource).toContain(
			"visibleFrame = CGRect(x: x, y: y, width: width, height: height)",
		);
		expect(recorderSource).toContain(
			"let captureRect = requestedFrame.intersection(display.frame)",
		);
		expect(recorderSource).toContain(
			"let sourceRect = Self.sourceRect(for: captureRect, on: display, scale: scaleFactor)",
		);
		expect(recorderSource).toContain("streamConfig.sourceRect = sourceRect");
	});

	it("records whole screen pixels at a bitrate sized for the frame rate", () => {
		expect(recorderSource).toMatch(/let width = max\(2, Int\(.*\) & ~1\)/);
		expect(recorderSource).toContain("averageBitRate * requestedFPS / assistantFPS");
		expect(recorderSource).toContain("compression[AVVideoExpectedSourceFrameRateKey] = requestedFPS");
	});

	it("records a fixed area of a display", () => {
		expect(recorderSource).toContain("let regionX: Double?");
		expect(recorderSource).toContain(
			"requestedFrame = CGRect(x: x, y: y, width: width, height: height)",
		);
	});

	it("refreshes the crop and capture display while the window moves or resizes", () => {
		expect(recorderSource).toContain(
			"guard let display = Self.captureDisplay(for: window.frame",
		);
		expect(recorderSource).toContain("try await activeStream.updateContentFilter(filter)");
		expect(recorderSource).toContain(
			"try await activeStream.updateConfiguration(streamConfiguration)",
		);
	});
});

describe("ScreenCaptureKitRecorder first frame timing", () => {
	const callback = recorderSource.slice(
		recorderSource.indexOf("func stream(_ stream:"),
		recorderSource.indexOf("func stream(_ stream:") + 5000,
	);
	const appendFrame = recorderSource.slice(
		recorderSource.indexOf("private func appendVideoFrame"),
		recorderSource.indexOf("private func appendPendingFirstFrame"),
	);
	it("validates a complete frame and writer readiness before setting time zero", () => {
		const clock = callback.indexOf("clock.videoTime(for:");
		expect(clock).toBeGreaterThan(callback.indexOf("status == .complete"));
		expect(clock).toBeGreaterThan(callback.indexOf("videoInput.isReadyForMoreMediaData"));
	});
	it("resets the origin after a rejected first frame and gates audio on accepted video", () => {
		expect(appendFrame).toMatch(/else if frameCount == 0\s*\{[^}]*clock\.clearOrigin\(\)/);
		expect(callback).toContain("guard let presentationTime = clock.audioTime(for:");
		expect(recorderSource).toContain(
			"guard origin.isValid, pauseStartedAt == nil else { return nil }",
		);
	});
});
