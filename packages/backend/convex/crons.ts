import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Refresh runs on the clock, not on demand. History cannot be backfilled: a Channel
 * nobody asked about today still has a subscriber count today, and if we do not write
 * it down now it is gone.
 *
 * Hourly, not daily: a run crawls a bounded batch, so the interval is how fast the
 * index drains its backlog of stale Channels, not how fresh any one Channel gets.
 */
crons.interval(
  "refresh due channels",
  { hours: 1 },
  internal.refresh.refreshDueChannels,
  {},
);

export default crons;
