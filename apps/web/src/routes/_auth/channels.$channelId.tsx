import { convexQuery } from "@convex-dev/react-query";
import { api } from "@nichehuntr-v2/backend/convex/_generated/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ChannelDetailView } from "@/components/channel/channel-detail";

export const Route = createFileRoute("/_auth/channels/$channelId")({
	component: ChannelDetailPage,
});

/**
 * The Channel detail route: holds the id from the URL, reads the Channel, hands it to the screen.
 *
 * A reactive Convex query — the detail reads flat documents Convex holds, so it live-updates as
 * the next Refresh rewrites the Channel, unlike search which must be an action over an external
 * engine (ADR-0001). `$channelId` is the Channel's YouTube id, the same id a result row links on.
 *
 * `data` is `undefined` while the read is in flight and `null` when the index holds no such
 * Channel; the screen renders both, because "still reading" and "nothing to show" are different
 * things to say and neither is a blank page.
 */
function ChannelDetailPage() {
	const { channelId } = Route.useParams();
	const { data } = useQuery(
		convexQuery(api.channels.detail.getChannelDetail, {
			youtubeChannelId: channelId,
		}),
	);

	return <ChannelDetailView channel={data} />;
}
