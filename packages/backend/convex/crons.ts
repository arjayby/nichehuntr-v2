import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { REFRESH_RUNS_PER_DAY } from "./refresh";

const HOURS_PER_DAY = 24;

const crons = cronJobs();

/**
 * Refresh runs on the clock, not on demand: a Channel nobody asked about today still
 * has a subscriber count today.
 *
 * Hourly, not daily: a run may spend only its share of the day's Crawl Budget, so this
 * interval sets how fast the index drains its backlog of due Channels, not how fresh any
 * one Channel is. The share and the interval are the same decision, so the run rate is
 * named once, in `refresh.ts`, and the schedule follows it.
 */
crons.interval(
	"refresh due channels",
	{ hours: HOURS_PER_DAY / REFRESH_RUNS_PER_DAY },
	internal.refresh.refreshDueChannels,
	{},
);

export default crons;
