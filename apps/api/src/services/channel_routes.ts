import type { Database } from '@coworker/core';
import {
  find_workspace_channel,
  update_channel_settings,
} from '@coworker/core/db/queries/channel_settings';
import { create_channel, list_channels } from '@coworker/core/db/queries/channels';
import {
  refuse_a_second_enabled_route,
  validate_channel_route_settings,
} from '@coworker/runtime-platform';
import { NotFoundError } from '@coworker/shared';

type ChannelRouteInput = Parameters<typeof create_channel>[1];

type ChannelRouteChange = {
  workspace_id: string;
  channel_id: string;
  channel_status?: 'enabled' | 'disabled' | 'error' | undefined;
  channel_config?: Record<string, unknown> | undefined;
  actor_id: string;
};

export function list_channel_routes(db: Database, workspace_id: string) {
  return list_channels(db, workspace_id);
}

export async function create_channel_route(db: Database, input: ChannelRouteInput) {
  const channel_config = validate_channel_route_settings(
    input.channel_provider_key,
    input.channel_config,
  );
  await refuse_a_second_enabled_route(db, {
    workspace_id: input.workspace_id,
    channel_provider_key: input.channel_provider_key,
    external_account_id: input.external_account_id,
  });
  return create_channel(db, { ...input, ...(channel_config ? { channel_config } : {}) });
}

export async function change_channel_route(db: Database, change: ChannelRouteChange) {
  const channel = await find_workspace_channel(db, change);
  if (!channel) throw new NotFoundError('Channel');
  const channel_config = change.channel_config
    ? validate_channel_route_settings(channel.channel_provider_key, change.channel_config)
    : undefined;
  if (change.channel_status === 'enabled') {
    await refuse_a_second_enabled_route(db, {
      workspace_id: channel.workspace_id,
      channel_provider_key: channel.channel_provider_key,
      external_account_id: channel.external_account_id,
      channel_id: channel.channel_id,
    });
  }
  return update_channel_settings(db, {
    workspace_id: channel.workspace_id,
    channel_id: channel.channel_id,
    channel_status: change.channel_status,
    channel_config,
    actor_id: change.actor_id,
  });
}
