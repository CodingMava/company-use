import type { Database } from '@coworker/core';
import { whatsapp_test_username_user_id } from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_fixtures';
import { create_workspace_with_whatsapp_route } from '@runtime-platform/channels/whatsapp/__tests__/whatsapp_workspace';
import {
  find_whatsapp_route,
  whatsapp_route_settings_schema,
} from '@runtime-platform/channels/whatsapp/channel_route';
import {
  build_whatsapp_source_actor,
  identify_whatsapp_sender,
} from '@runtime-platform/channels/whatsapp/sender_identity';
import type { WhatsAppSenderAddress } from '@runtime-platform/channels/whatsapp/webhook_payloads';
import { describe, expect, it } from 'vitest';

function phone(wa_id: string): WhatsAppSenderAddress {
  return { sender_key: wa_id, sender_wa_id: wa_id };
}

async function identify(db: Database, address: WhatsAppSenderAddress, profile_name?: string) {
  const lookup = await find_whatsapp_route(db, 'PNID_1');
  if (!lookup.found) throw new Error(`route not found: ${lookup.reason}`);
  return identify_whatsapp_sender(db, { route: lookup.route, address, profile_name });
}

describe('identify_whatsapp_sender', () => {
  it('treats a number the route lists as the member it names', async () => {
    const { db, user_id } = await create_workspace_with_whatsapp_route({
      member_phone_numbers: { '+39 333 123 4567': 'Founder@Runtime.local' },
    });

    const sender = await identify(db, phone('393331234567'), 'Giulia');

    expect(sender).toEqual({
      sender_key: '393331234567',
      sender_wa_id: '393331234567',
      display_name: 'Founder',
      match: 'member',
      member: { user_id, email: 'founder@runtime.local' },
    });
  });

  it('treats any other number as an outside sender', async () => {
    const { db } = await create_workspace_with_whatsapp_route({
      member_phone_numbers: { '+39 333 123 4567': 'founder@runtime.local' },
    });

    expect(await identify(db, phone('15557654321'), 'Sam')).toEqual({
      sender_key: '15557654321',
      sender_wa_id: '15557654321',
      display_name: 'Sam',
      match: 'phone_not_listed',
    });
  });

  it('treats a listed number whose email belongs to nobody as an outside sender', async () => {
    const { db } = await create_workspace_with_whatsapp_route({
      member_phone_numbers: { '393331234567': 'former.employee@example.com' },
    });

    const sender = await identify(db, phone('393331234567'));

    expect(sender).toMatchObject({
      display_name: '+393331234567',
      match: 'listed_email_matches_no_member',
    });
    expect(sender.member).toBeUndefined();
  });

  it('treats a username user whose phone Meta hides as an outside sender', async () => {
    const { db } = await create_workspace_with_whatsapp_route({
      member_phone_numbers: { '+39 333 123 4567': 'founder@runtime.local' },
    });

    const sender = await identify(db, {
      sender_key: whatsapp_test_username_user_id,
      sender_user_id: whatsapp_test_username_user_id,
    });

    expect(sender).toMatchObject({ display_name: 'WhatsApp user', match: 'phone_hidden' });
    expect(sender.member).toBeUndefined();
  });

  it('still knows the other members when one entry in the list is unreadable', async () => {
    const { db } = await create_workspace_with_whatsapp_route({
      member_phone_numbers: {
        '+1 555 0100': 'not an email',
        '+39 333 123 4567': ' founder@runtime.local ',
      },
    });

    const sender = await identify(db, phone('393331234567'));

    expect(sender.match).toBe('member');
  });
});

describe('build_whatsapp_source_actor', () => {
  it('carries the member email only for a member', () => {
    const member = build_whatsapp_source_actor(
      {
        ...phone('393331234567'),
        display_name: 'Founder',
        match: 'member',
        member: { user_id: 'user_1', email: 'founder@runtime.local' },
      },
      'PNID_1',
    );
    const outsider = build_whatsapp_source_actor(
      { ...phone('15557654321'), display_name: 'Sam', match: 'phone_not_listed' },
      'PNID_1',
    );

    expect(member.external_ids).toEqual([
      {
        provider_key: 'whatsapp',
        external_account_id: 'PNID_1',
        external_user_id: '393331234567',
      },
    ]);
    expect(member.profile).toMatchObject({
      email: 'founder@runtime.local',
      email_is_verified: true,
    });
    expect(outsider.profile.email ?? null).toBeNull();
  });
});

describe('find_whatsapp_route', () => {
  it('reads answer_outside_senders and keeps the number closed by default', async () => {
    const closed = await create_workspace_with_whatsapp_route();
    const open = await create_workspace_with_whatsapp_route({ answer_outside_senders: true });

    const closed_route = await find_whatsapp_route(closed.db, 'PNID_1');
    const open_route = await find_whatsapp_route(open.db, 'PNID_1');

    expect(closed_route).toMatchObject({ found: true, route: { answer_outside_senders: false } });
    expect(open_route).toMatchObject({ found: true, route: { answer_outside_senders: true } });
  });
});

describe('whatsapp_route_settings_schema', () => {
  it('accepts a phone list and tidies each email', () => {
    const settings = whatsapp_route_settings_schema.parse({
      member_phone_numbers: { '+39 333 123 4567': ' Giulia@Acme.com ' },
    });

    expect(settings).toEqual({
      member_phone_numbers: { '+39 333 123 4567': 'giulia@acme.com' },
      answer_outside_senders: false,
    });
  });

  it.each([
    { member_phone_numbers: { '+39 333 123 4567': 'not an email' } },
    { member_phone_numbers: { giulia: 'giulia@acme.com' } },
    { answer_outside_senders: 'false' },
    { member_phone_number: {} },
  ])('refuses settings an admin probably mistyped: %j', (settings) => {
    expect(whatsapp_route_settings_schema.safeParse(settings).success).toBe(false);
  });
});
