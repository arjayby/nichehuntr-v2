/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as channels_detail from "../channels/detail.js";
import type * as crawl_budget from "../crawl/budget.js";
import type * as crawl_priority from "../crawl/priority.js";
import type * as crons from "../crons.js";
import type * as discovery_channelSource from "../discovery/channelSource.js";
import type * as discovery_channelStats from "../discovery/channelStats.js";
import type * as discovery_entryBar from "../discovery/entryBar.js";
import type * as discovery_form from "../discovery/form.js";
import type * as discovery_outliers from "../discovery/outliers.js";
import type * as discovery_recentWindow from "../discovery/recentWindow.js";
import type * as discovery_signals from "../discovery/signals.js";
import type * as growth from "../growth.js";
import type * as healthCheck from "../healthCheck.js";
import type * as http from "../http.js";
import type * as ingestion from "../ingestion.js";
import type * as polar from "../polar.js";
import type * as privateData from "../privateData.js";
import type * as refresh from "../refresh.js";
import type * as search_channels from "../search/channels.js";
import type * as search_rebuild from "../search/rebuild.js";
import type * as search_searchIndex from "../search/searchIndex.js";
import type * as search_typesense from "../search/typesense.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "channels/detail": typeof channels_detail;
  "crawl/budget": typeof crawl_budget;
  "crawl/priority": typeof crawl_priority;
  crons: typeof crons;
  "discovery/channelSource": typeof discovery_channelSource;
  "discovery/channelStats": typeof discovery_channelStats;
  "discovery/entryBar": typeof discovery_entryBar;
  "discovery/form": typeof discovery_form;
  "discovery/outliers": typeof discovery_outliers;
  "discovery/recentWindow": typeof discovery_recentWindow;
  "discovery/signals": typeof discovery_signals;
  growth: typeof growth;
  healthCheck: typeof healthCheck;
  http: typeof http;
  ingestion: typeof ingestion;
  polar: typeof polar;
  privateData: typeof privateData;
  refresh: typeof refresh;
  "search/channels": typeof search_channels;
  "search/rebuild": typeof search_rebuild;
  "search/searchIndex": typeof search_searchIndex;
  "search/typesense": typeof search_typesense;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  polar: import("@convex-dev/polar/_generated/component.js").ComponentApi<"polar">;
};
