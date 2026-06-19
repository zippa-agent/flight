import type { ToolDefinition } from "@flue/runtime";
import type { FlightTurnPayload } from "../adapters/types";
import type { Env } from "../env";
import { availableToolCatalog } from "./catalog";

export function resolveTurnTools(input: {
  env: Env;
  instanceId: string;
  turn: FlightTurnPayload | null;
}): ToolDefinition[] {
  return availableToolCatalog(input)
    .map((entry) => entry.create?.())
    .filter((tool): tool is ToolDefinition => !!tool);
}

export function availableToolNames(input: {
  env: Env;
  turn: FlightTurnPayload | null;
}): string[] {
  return availableToolCatalog({
    env: input.env,
    instanceId: "00000000-0000-0000-0000-000000000000--agent--toolnames",
    turn: input.turn,
  }).map((entry) => entry.name);
}
