import type { CommandDefinition, ComponentHandler } from "./command.ts";
import { claimComponentHandler } from "@/features/sla/claim-components.ts";
import { redeemComponentHandler } from "@/features/sla/redeem.ts";
import { slaCommand } from "@/features/sla/sla.command.ts";
import { pingCommand } from "@/features/utility/ping.command.ts";

export const commands: readonly CommandDefinition[] = [slaCommand, pingCommand];

export const componentHandlers: readonly ComponentHandler[] = [
  claimComponentHandler,
  redeemComponentHandler,
];
