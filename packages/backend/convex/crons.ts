import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Refresh runs on the clock, not on demand: a Channel nobody asked about today still
 * has a subscriber count today.
 *
 * Hourly, not daily: a run spends a bounded Crawl Budget, so this interval sets how
 * fast the index drains its backlog of due Channels, not how fresh any one Channel is.
 */
crons.interval(
	"refresh due channels",
	{ hours: 1 },
	internal.refresh.refreshDueChannels,
	{},
);

export default crons;
