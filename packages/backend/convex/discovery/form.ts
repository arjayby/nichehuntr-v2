import { v } from "convex/values";

/** Form is a property of a Video, never of a Channel. */
export const formValidator = v.union(v.literal("short"), v.literal("longform"));

export type Form = "short" | "longform";

/** YouTube's own cutoff: an upload of 3 minutes or less can be a Short. */
const SHORT_MAX_DURATION_SECONDS = 180;

/**
 * Duration is the only Form evidence a ChannelSource gives us today. YouTube also
 * requires a Short to be vertical, so a short *landscape* clip is called a Short
 * here wrongly; correcting that means carrying aspect ratio on SourceVideo.
 */
export function deriveForm(durationSeconds: number): Form {
	return durationSeconds <= SHORT_MAX_DURATION_SECONDS ? "short" : "longform";
}
