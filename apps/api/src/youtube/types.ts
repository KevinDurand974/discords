export const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export class YoutubeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 | 413 | 502 | 503 = 502,
  ) {
    super(message);
    this.name = "YoutubeError";
  }
}

export type ChannelInput =
  | { kind: "handle"; handle: string; canonicalUrl: string }
  | { kind: "id"; channelId: string; canonicalUrl: string };

export type YoutubeVideo = {
  videoId: string;
  channelId: string;
  sourceEntryId: string;
  url: string;
  title: string;
  description: string;
  publishedAt: string;
  sourceUpdatedAt: string | null;
};

export type YoutubeFeed = {
  channelId: string;
  displayName: string;
  videos: YoutubeVideo[];
  rejectedEntries: number;
};

export type YoutubeChannelView = {
  channelId: string;
  canonicalUrl: string;
  handle: string | null;
  displayName: string;
  lastSyncedAt: string | null;
};

export type YoutubeReader = {
  channel(channelId: string): Promise<YoutubeChannelView | null>;
  videos(channelId: string, limit: number, cursor?: string): Promise<{
    items: YoutubeVideo[];
    nextCursor: string | null;
  }>;
};

export type YoutubeClient = {
  resolve(input: ChannelInput): Promise<string>;
  feed(channelId: string): Promise<YoutubeFeed>;
};
