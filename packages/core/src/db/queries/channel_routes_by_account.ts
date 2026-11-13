import type { Database } from '@coworker/core/db/connection';
import { channels } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

export async function list_enabled_channels_by_external_account(
  db: Database,
  input: { channel_provider_key: string; external_account_id: string },
) {
  return db.query.channels.findMany({
    where: and(
      eq(channels.channel_provider_key, input.channel_provider_key),
      eq(channels.external_account_id, input.external_account_id),
      eq(channels.channel_status, 'enabled'),
    ),
    limit: 2,
  });
}
