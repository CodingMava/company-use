import type { Database } from '@coworker/core';
import { list_enabled_channels_by_external_account } from '@coworker/core/db/queries/channel_routes_by_account';
import { ConflictError, ValidationError } from '@coworker/shared';
import { whatsapp_route_settings_schema } from '@runtime-platform/channels/whatsapp/channel_route';
import type { z } from 'zod';

type ChannelRouteSettings = Record<string, unknown>;

type ChannelRouteRule = {
  settings_schema: z.ZodType<ChannelRouteSettings>;
  one_enabled_route_per_account: boolean;
};

const channel_route_rules: Record<string, ChannelRouteRule> = {
  whatsapp: {
    settings_schema: whatsapp_route_settings_schema,
    one_enabled_route_per_account: true,
  },
};

export function validate_channel_route_settings(
  channel_provider_key: string,
  channel_config: ChannelRouteSettings | undefined,
): ChannelRouteSettings | undefined {
  const rule = channel_route_rules[channel_provider_key];
  if (!rule) return channel_config;
  const parsed = rule.settings_schema.safeParse(channel_config ?? {});
  if (!parsed.success) {
    const fields = parsed.error.issues.map(
      (issue) => issue.path.map(String).join('.') || 'channel_config',
    );
    throw new ValidationError(
      `The ${channel_provider_key} channel settings are not valid. Check: ${fields.join(', ')}.`,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

export async function refuse_a_second_enabled_route(
  db: Database,
  input: {
    workspace_id: string;
    channel_provider_key: string;
    external_account_id: string | null | undefined;
    channel_id?: string;
  },
) {
  const rule = channel_route_rules[input.channel_provider_key];
  if (!rule?.one_enabled_route_per_account || !input.external_account_id) return;
  const routes = await list_enabled_channels_by_external_account(db, {
    channel_provider_key: input.channel_provider_key,
    external_account_id: input.external_account_id,
  });
  const other_route = routes.find((route) => route.channel_id !== input.channel_id);
  if (!other_route) return;
  if (other_route.workspace_id !== input.workspace_id) {
    throw new ConflictError(
      `Another workspace already answers ${input.channel_provider_key} account ${input.external_account_id}.`,
    );
  }
  throw new ConflictError(
    `Channel ${other_route.channel_id} already answers this account. Change it with PATCH /v1/channels/${other_route.channel_id}, or disable it first.`,
    { channel_id: other_route.channel_id },
  );
}
