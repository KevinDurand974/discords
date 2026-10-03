import type { CommandDefinition, ComponentHandler } from "./command.ts";
import { videosCommand, videosComponentHandler } from "@/features/youtube-videos/videos.command.ts";
import { claimComponentHandler } from "@/features/sla/claim-components.ts";
import { newsCleanComponentHandler } from "@/features/netmarble-news/news-setup-command.ts";
import { redeemComponentHandler } from "@/features/sla/redeem.ts";
import { setupCommand, setupComponentHandler } from "@/features/setup/setup.command.ts";
import { slaCommand } from "@/features/sla/sla.command.ts";
import { pingCommand } from "@/features/utility/ping.command.ts";

export const commands: readonly CommandDefinition[] = [
  setupCommand,
  slaCommand,
  pingCommand,
  videosCommand,
];

export const componentHandlers: readonly ComponentHandler[] = [
  claimComponentHandler,
  redeemComponentHandler,
  setupComponentHandler,
  newsCleanComponentHandler,
  videosComponentHandler,
];
