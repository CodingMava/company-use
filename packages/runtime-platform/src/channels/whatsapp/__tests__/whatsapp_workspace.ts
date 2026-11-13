import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { update_channel_settings } from '@coworker/core/db/queries/channel_settings';
import { create_channel } from '@coworker/core/db/queries/channels';
import { workspaces } from '@coworker/core/db/schema';
import { whatsapp_test_phone_number_id } from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_fixtures';
import { find_whatsapp_route } from '@runtime-platform/channels/whatsapp/channel_route';

export const listed_founder = {
  member_phone_numbers: { '+39 333 123 4567': 'founder@runtime.local' },
};

export async function create_workspace_with_whatsapp_route(
  channel_config: Record<string, unknown> = {},
) {
  const db = await create_test_database();
  const workspace = await bootstrap_default_workspace(db);
  await add_whatsapp_route(db, {
    workspace_id: workspace.workspace_id,
    agent_id: workspace.agent_id,
    actor_id: workspace.user_id,
    channel_config,
  });
  return { db, ...workspace };
}

export async function add_whatsapp_route(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    actor_id: string;
    channel_config?: Record<string, unknown>;
  },
) {
  return create_channel(db, {
    workspace_id: input.workspace_id,
    channel_provider_key: 'whatsapp',
    external_account_id: whatsapp_test_phone_number_id,
    target_kind: 'agent',
    target_id: input.agent_id,
    channel_config: input.channel_config ?? {},
    actor_id: input.actor_id,
  });
}

export async function change_whatsapp_route_settings(
  db: Database,
  workspace_id: string,
  channel_config: Record<string, unknown>,
) {
  const lookup = await find_whatsapp_route(db, whatsapp_test_phone_number_id);
  if (!lookup.found) throw new Error(`route not found: ${lookup.reason}`);
  await update_channel_settings(db, {
    workspace_id,
    channel_id: lookup.route.channel_id,
    channel_config,
    actor_id: 'system:test',
  });
}

export async function create_second_workspace(db: Database) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: 'Globex',
      workspace_slug: 'globex',
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!workspace) throw new Error('workspace seed failed');
  return workspace;
}
