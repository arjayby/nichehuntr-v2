import { describe, expect, it } from "vitest";
import type { Form } from "./form";
import { RECENT_WINDOW_DAYS } from "./recentWindow";
import {
  computeSignals,
  type SignalChannel,
  type SignalVideo,
} from "./signals";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 13);
const daysAgo = (days: number) => now - days * DAY;

/** Comfortably outside the recent window. */
const OLD = RECENT_WINDOW_DAYS * 3;

/** 5m lifetime views over 100 lifetime Videos: a lifetime average Video of 50k. */
const aChannel = (overrides: Partial<SignalChannel> = {}): SignalChannel => ({
  subscriberCount: 10_000,
  totalViewCount: 5_000_000,
  videoCount: 100,
  publishedAt: daysAgo(400),
  ...overrides,
});

const aVideo = (
  publishedDaysAgo: number,
  viewCount: number,
  form: Form = "longform",
): SignalVideo => ({
  publishedAt: daysAgo(publishedDaysAgo),
  viewCount,
  form,
});

const signalsOf = (channel: SignalChannel, videos: SignalVideo[]) =>
  computeSignals({ channel, videos, now });

describe("Views per Subscriber", () => {
  it("is the Channel's lifetime views divided by the audience that earned them", () => {
    const signals = signalsOf(
      aChannel({ subscriberCount: 10_000, totalViewCount: 5_000_000 }),
      [aVideo(1, 100)],
    );

    expect(signals.viewsPerSubscriber).toBe(500);
  });

  it("is undefined for a Channel with no subscribers, rather than dividing by zero", () => {
    const signals = signalsOf(
      aChannel({ subscriberCount: 0, totalViewCount: 800_000 }),
      [aVideo(1, 800_000)],
    );

    expect(signals.viewsPerSubscriber).toBeUndefined();
  });
});

describe("Median Views per Video", () => {
  it("is the middle Video's views, so one viral fluke cannot move it", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 1_000_000),
      aVideo(2, 200),
      aVideo(3, 100),
    ]);

    expect(signals.medianViewsPerVideo).toBe(200);
  });

  it("averages the two middle Videos when the Channel has an even number of them", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 400),
      aVideo(2, 300),
      aVideo(3, 200),
      aVideo(4, 100),
    ]);

    expect(signals.medianViewsPerVideo).toBe(250);
  });

  it("is undefined for a Channel we have crawled no Videos for", () => {
    const signals = signalsOf(aChannel(), []);

    expect(signals.medianViewsPerVideo).toBeUndefined();
  });
});

describe("Outlier Ratio", () => {
  it("is how far the Channel's best recent Video beat its own typical Video", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 900),
      aVideo(2, 300),
      aVideo(3, 100),
    ]);

    expect(signals.outlierRatio).toBe(3);
  });

  it("is 1 for a Channel with a single Video, which is its own median", () => {
    const signals = signalsOf(aChannel(), [aVideo(1, 42_000)]);

    expect(signals.outlierRatio).toBe(1);
  });

  it("does not let an old viral hit pose as an idea that just printed", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 500),
      aVideo(2, 300),
      aVideo(OLD, 1_000_000),
    ]);

    // The million-view Video is months old. The best *recent* Video did 500, against a
    // typical Video of 500 — this Channel is not currently printing anything.
    expect(signals.outlierRatio).toBe(1);
  });

  it("is undefined for a Channel with no recent Video to be an outlier", () => {
    const signals = signalsOf(aChannel(), [aVideo(OLD, 1_000_000)]);

    expect(signals.outlierRatio).toBeUndefined();
  });

  it("is undefined when the typical Video has no views at all", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 500),
      aVideo(2, 0),
      aVideo(3, 0),
    ]);

    expect(signals.outlierRatio).toBeUndefined();
  });
});

describe("Momentum", () => {
  it("is the Channel's recent Videos against its own lifetime average Video", () => {
    // The Channel's lifetime average Video: 5m views over 100 Videos = 50k.
    const signals = signalsOf(aChannel(), [
      aVideo(1, 200_000),
      aVideo(2, 100_000),
    ]);

    // Its recent Videos average 150k — three times its lifetime average.
    expect(signals.momentum).toBe(3);
  });

  it("is below 1 for a Channel whose recent Videos underperform its own history", () => {
    const signals = signalsOf(aChannel(), [aVideo(1, 10_000)]);

    expect(signals.momentum).toBe(0.2);
  });

  it("still separates a heating Channel from its own past when every crawled Video is recent", () => {
    // A Channel uploading several times a week: every Video the crawl returns falls
    // inside the window. The baseline has to come from its lifetime stats, or Momentum
    // would be comparing the recent Videos to themselves and collapse to 1.0 — blind to
    // exactly the fast-moving Channels the product exists to find.
    const rocket = aChannel({ totalViewCount: 100_000, videoCount: 100 });

    const signals = signalsOf(rocket, [
      aVideo(1, 800_000, "short"),
      aVideo(3, 600_000, "short"),
      aVideo(5, 400_000, "short"),
    ]);

    // A lifetime average Video of 1k, against recent Videos averaging 600k.
    expect(signals.momentum).toBe(600);
  });

  it("needs only one crawl: it never asks for a Channel Snapshot", () => {
    // Publish dates, view counts and the Channel's own lifetime stats are all that
    // Momentum reads — and all a single crawl returns.
    const signals = signalsOf(aChannel(), [aVideo(1, 50_000)]);

    expect(signals.momentum).toBe(1);
  });

  it("is undefined — not zero — for a Channel with no Videos in the recent window", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(OLD, 900_000),
      aVideo(OLD + 10, 700_000),
    ]);

    expect(signals.momentum).toBeUndefined();
    expect(signals.momentum).not.toBe(0);
  });

  it("is undefined for a Channel with no lifetime history to compare against", () => {
    const signals = signalsOf(aChannel({ totalViewCount: 0, videoCount: 0 }), [
      aVideo(1, 1_000),
    ]);

    expect(signals.momentum).toBeUndefined();
  });
});

describe("Upload Cadence", () => {
  it("is the Videos the Channel published per week in the recent window", () => {
    const videos = Array.from({ length: RECENT_WINDOW_DAYS }, (_, index) =>
      aVideo(index, 1_000),
    );

    const signals = signalsOf(aChannel(), videos);

    // One Video a day for the whole window is seven a week.
    expect(signals.uploadCadencePerWeek).toBeCloseTo(7);
  });

  it("is zero for a Channel that has not uploaded recently — that is a fact, not a gap", () => {
    const signals = signalsOf(aChannel(), [aVideo(OLD, 900_000)]);

    expect(signals.uploadCadencePerWeek).toBe(0);
  });
});

describe("Channel Age", () => {
  it("is how many days ago the Channel was created on YouTube", () => {
    const signals = signalsOf(aChannel({ publishedAt: daysAgo(120) }), [
      aVideo(1, 100),
    ]);

    expect(signals.channelAgeDays).toBe(120);
  });
});

describe("Form Shares", () => {
  it("keeps what a Channel makes separate from what actually works for it", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 1_000, "short"),
      aVideo(2, 1_000, "short"),
      aVideo(3, 1_000, "short"),
      aVideo(4, 97_000, "longform"),
    ]);

    // Three of its four uploads are Shorts, but they earn 3% of its views: a Channel
    // whose business is its long-form. A single Form verdict would have hidden that.
    expect(signals.shortsUploadShare).toBe(0.75);
    expect(signals.shortsViewShare).toBeCloseTo(0.03);
  });

  it("measures only the recent window, so a Channel that has switched Form shows it", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 5_000, "short"),
      aVideo(2, 5_000, "short"),
      aVideo(OLD, 500_000, "longform"),
      aVideo(OLD + 10, 500_000, "longform"),
    ]);

    // It used to be a long-form Channel. It is a Shorts Channel now, and the Signal
    // reports what it is doing now — not the average of everything it has ever done.
    expect(signals.shortsUploadShare).toBe(1);
    expect(signals.shortsViewShare).toBe(1);
  });

  it("is 1.0 on both shares for an all-Shorts Channel", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 800_000, "short"),
      aVideo(2, 20, "short"),
    ]);

    expect(signals.shortsUploadShare).toBe(1);
    expect(signals.shortsViewShare).toBe(1);
  });

  it("is 0 on both shares for an all-Long-form Channel", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 800_000, "longform"),
      aVideo(2, 20, "longform"),
    ]);

    expect(signals.shortsUploadShare).toBe(0);
    expect(signals.shortsViewShare).toBe(0);
  });

  it("is undefined for a Channel with no recent Videos to measure", () => {
    const signals = signalsOf(aChannel(), [aVideo(OLD, 900_000, "short")]);

    expect(signals.shortsUploadShare).toBeUndefined();
    expect(signals.shortsViewShare).toBeUndefined();
  });

  it("leaves View Share undefined when no recent Video has been viewed at all", () => {
    const signals = signalsOf(aChannel(), [
      aVideo(1, 0, "short"),
      aVideo(2, 0, "longform"),
    ]);

    expect(signals.shortsUploadShare).toBe(0.5);
    expect(signals.shortsViewShare).toBeUndefined();
  });
});

describe("the set of Signals", () => {
  it("has no composite score: every Signal is explainable on its own", () => {
    const signals = signalsOf(aChannel(), [aVideo(1, 1_000)]);

    expect(Object.keys(signals).sort()).toEqual([
      "channelAgeDays",
      "medianViewsPerVideo",
      "momentum",
      "outlierRatio",
      "shortsUploadShare",
      "shortsViewShare",
      "uploadCadencePerWeek",
      "viewsPerSubscriber",
    ]);
  });
});
