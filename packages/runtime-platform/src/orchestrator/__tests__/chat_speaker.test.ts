import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { source_actors } from '@coworker/core/db/schema';
import { create_external_source_actor } from '@coworker/shared';
import { resolve_chat_speaker } from '@runtime-platform/orchestrator/chat_speaker';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

async function resolve_external_speaker(provider_key: string, external_user_id: string) {
  const db = await create_test_database();
  const workspace = await bootstrap_default_workspace(db);
  const speaker = await resolve_chat_speaker(db, {
    workspace_id: workspace.workspace_id,
    actor_id: `system:${provider_key}`,
    source_metadata: {
      source_actor: create_external_source_actor({
        provider_key,
        external_user_id,
        profile: { display_name: 'Ada Lovelace', email: 'ada@example.com' },
      }),
    },
  });
  const rows = await db
    .select({ provider: source_actors.provider, external_id: source_actors.external_id })
    .from(source_actors)
    .where(eq(source_actors.workspace_id, workspace.workspace_id));
  return { speaker, rows };
}

describe('resolve_chat_speaker', () => {
  it('records an email sender under the email provider', async () => {
    const { speaker, rows } = await resolve_external_speaker('email', 'ada@example.com');

    expect(speaker).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(rows).toContainEqual({ provider: 'email', external_id: 'ada@example.com' });
    expect(rows.filter((row) => row.provider === 'slack')).toEqual([]);
  });

  it('records a Slack sender under the slack provider', async () => {
    const { rows } = await resolve_external_speaker('slack', 'U_ADA');

    expect(rows).toContainEqual({ provider: 'slack', external_id: 'U_ADA' });
  });

  it('forgets the email of a sender who no longer carries one', async () => {
    const db = await create_test_database();
    const workspace = await bootstrap_default_workspace(db);
    const speak = (email?: string) =>
      resolve_chat_speaker(db, {
        workspace_id: workspace.workspace_id,
        actor_id: 'system:whatsapp',
        source_metadata: {
          source_actor: create_external_source_actor({
            provider_key: 'whatsapp',
            external_user_id: '393331234567',
            profile: { display_name: 'Giulia', ...(email ? { email } : {}) },
          }),
        },
      });

    await speak('founder@runtime.local');
    await speak();

    const [row] = await db
      .select({ email: source_actors.email })
      .from(source_actors)
      .where(eq(source_actors.external_id, '393331234567'));
    expect(row?.email ?? null).toBeNull();
  });
});
