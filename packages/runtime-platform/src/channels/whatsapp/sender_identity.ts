import type { Database } from '@coworker/core';
import { list_members_to_match_by_email } from '@coworker/core/db/queries/team_match_emails';
import { create_external_source_actor, type SourceActor } from '@coworker/shared';
import type { WhatsAppRoute } from '@runtime-platform/channels/whatsapp/channel_route';
import type { WhatsAppSenderAddress } from '@runtime-platform/channels/whatsapp/webhook_payloads';

export type WhatsAppSenderMatch =
  | 'member'
  | 'phone_hidden'
  | 'phone_not_listed'
  | 'listed_email_matches_no_member';

export type WhatsAppSender = WhatsAppSenderAddress & {
  display_name: string;
  match: WhatsAppSenderMatch;
  member?: { user_id: string; email: string };
};

export async function identify_whatsapp_sender(
  db: Database,
  input: {
    route: WhatsAppRoute;
    address: WhatsAppSenderAddress;
    profile_name?: string | undefined;
  },
): Promise<WhatsAppSender> {
  const sender_as = (match: WhatsAppSenderMatch): WhatsAppSender => ({
    ...input.address,
    display_name: input.profile_name ?? fallback_display_name(input.address),
    match,
  });
  const phone = input.address.sender_wa_id;
  if (!phone) return sender_as('phone_hidden');
  const member_email = input.route.member_emails_by_wa_id.get(phone);
  if (!member_email) return sender_as('phone_not_listed');

  const members = await list_members_to_match_by_email(db, input.route.workspace_id);
  const member = members.find((row) => row.email.toLowerCase() === member_email);
  if (!member) return sender_as('listed_email_matches_no_member');

  const real_name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return {
    ...sender_as('member'),
    ...(real_name ? { display_name: real_name } : {}),
    member: { user_id: member.user_id, email: member_email },
  };
}

export function build_whatsapp_source_actor(
  sender: WhatsAppSender,
  phone_number_id: string,
): SourceActor {
  return create_external_source_actor({
    provider_key: 'whatsapp',
    external_account_id: phone_number_id,
    external_user_id: sender.sender_key,
    profile: {
      display_name: sender.display_name,
      ...(sender.member ? { email: sender.member.email, email_is_verified: true } : {}),
      profile_source: 'event_payload',
    },
    policy_state: 'allowed_to_chat',
  });
}

function fallback_display_name(address: WhatsAppSenderAddress) {
  return address.sender_wa_id ? `+${address.sender_wa_id}` : 'WhatsApp user';
}
