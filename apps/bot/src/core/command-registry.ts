import type { CommandDefinition, ComponentHandler } from "./command.ts";
import {
  youtubeCommand,
  youtubeComponentHandler,
} from "@/features/youtube-videos/videos.command.ts";
import { claimComponentHandler } from "@/features/sla/claim-components.ts";
import { createCouponComponentHandler } from "@/features/sla/create-coupon.ts";
import { newsCleanComponentHandler } from "@/features/netmarble-news/news-setup-command.ts";
import { redeemComponentHandler } from "@/features/sla/redeem.ts";
import { setupCommand, setupComponentHandler } from "@/features/setup/setup.command.ts";
import { slaCommand } from "@/features/sla/sla.command.ts";
import { pingCommand } from "@/features/utility/ping.command.ts";
import { pollCommand } from "@/features/polls/poll.command.ts";
import { pollComponentHandler } from "@/features/polls/poll-modal.ts";
import { ticketCommand } from "@/features/tickets/ticket.command.ts";
import { closeCommand } from "@/features/tickets/close.command.ts";
import { ticketClosureComponentHandler } from "@/features/tickets/ticket-closure-components.ts";
import { ticketComponentHandler } from "@/features/tickets/ticket-modal.ts";
import { createHelpCommand } from "@/features/utility/help.command.ts";

export const helpCommand = createHelpCommand(() => commands);

export const commands: readonly CommandDefinition[] = [
  setupCommand,
  slaCommand,
  pingCommand,
  helpCommand,
  youtubeCommand,
  pollCommand,
  ticketCommand,
  closeCommand,
];

export const componentHandlers: readonly ComponentHandler[] = [
  claimComponentHandler,
  createCouponComponentHandler,
  redeemComponentHandler,
  setupComponentHandler,
  newsCleanComponentHandler,
  youtubeComponentHandler,
  pollComponentHandler,
  ticketComponentHandler,
  ticketClosureComponentHandler,
];
