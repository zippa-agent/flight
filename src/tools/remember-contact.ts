import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import {
  contactBookPath,
  rememberContactIdentity,
  type ContactConfidence,
  type ContactIdentityKind,
  type ContactKind,
} from "../listener/contacts";

const RememberContactInput = v.object({
  identity_kind: v.union([
    v.literal("phone"),
    v.literal("email"),
    v.literal("slack"),
    v.literal("other"),
  ]),
  identity: v.pipe(v.string(), v.minLength(1), v.maxLength(300)),
  display_name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  kind: v.optional(v.union([
    v.literal("person"),
    v.literal("company"),
    v.literal("agent"),
    v.literal("unknown"),
  ])),
  confidence: v.optional(v.union([
    v.literal("confirmed"),
    v.literal("inferred"),
  ])),
  notes: v.optional(v.pipe(v.string(), v.maxLength(1_000))),
});

export function createRememberContactTool(input: {
  env: Env;
  agentId: string;
}): ToolDefinition {
  return defineTool({
    name: "remember_contact",
    description:
      "Remember or update a local contact label in this agent's R2 contact book. Use it only when the user/admin states a mapping or a trusted CRM/contact lookup clearly confirms it.",
    parameters: RememberContactInput,
    execute: async (args) => {
      const result = await rememberContactIdentity({
        env: input.env,
        agentId: input.agentId,
        identityKind: args.identity_kind as ContactIdentityKind,
        identity: args.identity,
        displayName: args.display_name,
        kind: args.kind as ContactKind | undefined,
        confidence: args.confidence as ContactConfidence | undefined,
        notes: args.notes,
        source: "agent",
      });

      return JSON.stringify({
        ok: true,
        identity: result.identityKey,
        display_name: result.entry.displayName,
        confidence: result.entry.confidence || null,
        contact_book: contactBookPath(),
      }, null, 2);
    },
  });
}
