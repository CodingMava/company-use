import type { RuntimeAgentEngine } from '@agent-core/runs';
import type { Database } from '@coworker/core/db/connection';
import { set_policy } from '@coworker/core/db/queries/policies';
import { apps, nodes } from '@coworker/core/db/schema';
import { authorize_outbound_email } from '@runtime-platform/channels/email/outbound_policy';
import {
  record_graph_calls,
  send_accepted_whatsapp_text,
} from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_turn_harness';
import {
  create_workspace_with_whatsapp_route,
  listed_founder,
} from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_workspace';
import { configure_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const outside_node_key = 'reviews-publish_reply-1';

let outside_action_results: unknown[] = [];

const engine_that_tries_one_outside_action = (): RuntimeAgentEngine => ({
  engine_name: 'agent-core/pi/whatsapp-member-authority-test',
  async *run(input) {
    const execute_tool = input.tools.find((tool) => tool.tool_name.includes('execute_tool'));
    if (!execute_tool?.execute) throw new Error('the run was given no catalog tool door');
    outside_action_results.push(
      await execute_tool.execute(
        { node_key: outside_node_key, input: {} },
        { run_key: input.run_key, metadata: input.metadata, signal: input.signal },
      ),
    );
    yield {
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    };
  },
});

async function insert_tool_that_changes_something_outside(db: Database) {
  const actor_id = 'system:test';
  await db.insert(apps).values({
    app_id: 'app_reviews',
    app_name: 'reviews',
    app_key: 'reviews',
    catalog_scope: 'global',
    app_display_name: 'Reviews',
    auth_type: 'none',
    app_status: 'active',
    metadata: {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(nodes).values({
    node_id: 'node_reviews_publish_reply',
    app_id: 'app_reviews',
    app_key: 'reviews',
    node_name: 'publish_reply',
    catalog_scope: 'global',
    node_key: outside_node_key,
    node_version: 1,
    node_display_name: 'Publish a reply',
    node_kind: 'action',
    input_schema: { type: 'object', properties: {} },
    runtime_handler: 'unsupported.no_provider_in_this_test',
    node_runtime: 'connected_app',
    approval_policy: { mode: 'manual_review' },
    metadata: {},
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

async function run_a_whatsapp_message(channel_config: Record<string, unknown>, wa_id: string) {
  const { db, workspace_id, user_id } = await create_workspace_with_whatsapp_route(channel_config);
  await seed_runtime_tool_catalog(db);
  await insert_tool_that_changes_something_outside(db);
  await set_policy(db, {
    workspace_id,
    resource_type: 'node',
    resource_id: outside_node_key,
    scope_type: 'workspace',
    scope_id: workspace_id,
    policy_mode: 'allow',
    actor_id: user_id,
  });
  await send_accepted_whatsapp_text(db, { wa_id, text: 'Publish the reply.' });
  return JSON.stringify(outside_action_results[0]);
}

function whatsapp_source_context(sender_is_workspace_member: boolean) {
  return {
    source_type: 'whatsapp' as const,
    source_metadata: {
      whatsapp: {
        phone_number_id: 'PNID_1',
        display_phone_number: '15550001111',
        sender_key: '393331234567',
        sender_wa_id: '393331234567',
        sender_is_workspace_member,
        message_ids: ['wamid.ONE'],
      },
    },
  };
}

describe('what a WhatsApp run may change outside the workspace', () => {
  beforeEach(() => {
    outside_action_results = [];
    configure_agent_engine(engine_that_tries_one_outside_action);
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-never-sent');
    record_graph_calls();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('acts for a teammate whose number an admin listed', async () => {
    const outside_action = await run_a_whatsapp_message(listed_founder, '393331234567');

    expect(outside_action).not.toContain('approval_required');
    expect(outside_action).toContain('unsupported_catalog_tool');
  });

  it('is refused for an outside sender', async () => {
    const outside_action = await run_a_whatsapp_message(
      { answer_outside_senders: true },
      '15557654321',
    );

    expect(outside_action).toContain('no human authority');
  });
});

describe('authorize_outbound_email on a WhatsApp turn', () => {
  it('lets a listed teammate email someone outside the workspace', async () => {
    const { db, workspace_id } = await create_workspace_with_whatsapp_route();

    const teammate = await authorize_outbound_email(db, {
      workspace_id,
      session_id: 'sess_whatsapp',
      recipients: ['client@example.com'],
      source_context: whatsapp_source_context(true),
    });
    const outsider = await authorize_outbound_email(db, {
      workspace_id,
      session_id: 'sess_whatsapp',
      recipients: ['client@example.com'],
      source_context: whatsapp_source_context(false),
    });

    expect(teammate).toEqual({ allowed: true });
    expect(outsider).toMatchObject({ allowed: false, code: 'recipient_not_authorized' });
  });
});
