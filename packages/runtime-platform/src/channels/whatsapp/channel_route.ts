import type { Database } from '@coworker/core';
import { list_enabled_channels_by_external_account } from '@coworker/core/db/queries/channel_routes_by_account';
import { create_logger } from '@coworker/shared';
import { z } from 'zod';

const log = create_logger('whatsapp_channel_route');

const member_email_schema = z.string().trim().toLowerCase().pipe(z.email());

export const whatsapp_route_settings_schema = z
  .object({
    member_phone_numbers: z
      .record(
        z
          .string()
          .refine(
            is_a_phone_number,
            'Write each phone number with its country code, like +39 333 123 4567.',
          ),
        member_email_schema,
      )
      .default({}),
    answer_outside_senders: z.boolean().default(false),
  })
  .strict();

const whatsapp_route_config_schema = z.object({
  member_phone_numbers: z.record(z.string(), z.unknown()).default({}),
  answer_outside_senders: z.boolean().default(false),
});

export type WhatsAppRoute = {
  workspace_id: string;
  channel_id: string;
  project_id: string | null;
  member_emails_by_wa_id: ReadonlyMap<string, string>;
  answer_outside_senders: boolean;
};

export type WhatsAppRouteLookup =
  | { found: true; route: WhatsAppRoute }
  | { found: false; reason: 'route_missing' | 'route_ambiguous' | 'route_config_invalid' };

export async function find_whatsapp_route(
  db: Database,
  phone_number_id: string,
): Promise<WhatsAppRouteLookup> {
  const [channel, second_channel] = await list_enabled_channels_by_external_account(db, {
    channel_provider_key: 'whatsapp',
    external_account_id: phone_number_id,
  });
  if (!channel) return { found: false, reason: 'route_missing' };
  if (second_channel) return { found: false, reason: 'route_ambiguous' };

  const config = whatsapp_route_config_schema.safeParse(channel.channel_config);
  if (!config.success) return { found: false, reason: 'route_config_invalid' };
  return {
    found: true,
    route: {
      workspace_id: channel.workspace_id,
      channel_id: channel.channel_id,
      project_id: channel.project_id,
      member_emails_by_wa_id: map_member_phone_numbers(
        channel.channel_id,
        config.data.member_phone_numbers,
      ),
      answer_outside_senders: config.data.answer_outside_senders,
    },
  };
}

export function whatsapp_phone_digits(phone_number: string) {
  return phone_number.replace(/\D/gu, '');
}

function is_a_phone_number(phone_number: string) {
  return whatsapp_phone_digits(phone_number).length >= 7;
}

function map_member_phone_numbers(
  channel_id: string,
  member_phone_numbers: Record<string, unknown>,
) {
  const entries = Object.entries(member_phone_numbers).flatMap(([phone_number, value]) => {
    const email = member_email_schema.safeParse(value);
    const digits = whatsapp_phone_digits(phone_number);
    return email.success && is_a_phone_number(digits) ? [[digits, email.data] as const] : [];
  });
  const skipped_count = Object.keys(member_phone_numbers).length - entries.length;
  if (skipped_count > 0) {
    log.warn('whatsapp route skipped member phone entries it could not read', {
      channel_id,
      skipped_count,
    });
  }
  return new Map(entries);
}
