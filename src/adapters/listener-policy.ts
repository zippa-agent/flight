import { isRecord } from "./types";

export function resolvePromptOnDelivery(input: {
  headers?: Headers;
  body?: unknown;
  defaultValue: boolean;
}): boolean {
  const headerValue = input.headers?.get("x-flight-prompt-on-delivery");
  const fromHeader = booleanValue(headerValue);
  if (fromHeader !== undefined) return fromHeader;

  const body = isRecord(input.body) ? input.body : {};
  const direct = booleanValue(body.prompt_on_delivery)
    ?? booleanValue(body.promptOnDelivery)
    ?? booleanValue(body.listener_prompt_on_delivery)
    ?? booleanValue(body.listenerPromptOnDelivery);
  if (direct !== undefined) return direct;

  const listener = isRecord(body.listener) ? body.listener : {};
  const fromListener = booleanValue(listener.prompt_on_delivery)
    ?? booleanValue(listener.promptOnDelivery);
  if (fromListener !== undefined) return fromListener;

  const providerData = isRecord(body.providerData) ? body.providerData : {};
  const fromProviderData = booleanValue(providerData.prompt_on_delivery)
    ?? booleanValue(providerData.promptOnDelivery)
    ?? booleanValue(providerData.listener_prompt_on_delivery)
    ?? booleanValue(providerData.listenerPromptOnDelivery);
  if (fromProviderData !== undefined) return fromProviderData;

  return input.defaultValue;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}
