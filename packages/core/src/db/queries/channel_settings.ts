import type { Database } from '@coworker/core/db/connection';
import { channels } from '@coworker/core/db/schema';
import type { ChannelConfigData } from '@coworker/core/db/schema/channel_config_data';
import { and, eq } from 'drizzle-orm';

type ChannelStatus = 'enabled' | 'disabled' | 'error';

export async function find_workspace_channel(
  db: Database,
  input: { workspace_id: string; channel_id: string },
) {
  const channel = await db.query.channels.findFirst({
    where: and(
      eq(channels.workspace_id, input.workspace_id),
      eq(channels.channel_id, input.channel_id),
    ),
  });
  return channel ?? null;
}

export async function update_channel_settings(
  db: Database,
  input: {
    workspace_id: string;
    channel_id: string;
    channel_status?: ChannelStatus | undefined;
    channel_config?: ChannelConfigData | undefined;
    actor_id: string;
  },
) {
  const [channel] = await db
    .update(channels)
    .set({
      ...(input.channel_status ? { channel_status: input.channel_status } : {}),
      ...(input.channel_config ? { channel_config: input.channel_config } : {}),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(eq(channels.workspace_id, input.workspace_id), eq(channels.channel_id, input.channel_id)),
    )
    .returning();
  return channel ?? null;
}
