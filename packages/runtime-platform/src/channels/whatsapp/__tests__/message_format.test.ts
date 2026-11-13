import {
  format_whatsapp_text,
  split_whatsapp_text,
} from '@runtime-platform/channels/whatsapp/message_format';
import { describe, expect, it } from 'vitest';

describe('format_whatsapp_text', () => {
  it('turns Markdown emphasis into WhatsApp emphasis', () => {
    expect(format_whatsapp_text('**Paid** on *Monday* and ~~late~~')).toBe(
      '*Paid* on _Monday_ and ~late~',
    );
  });

  it('turns headings into bold lines and bullets into dashes', () => {
    expect(format_whatsapp_text('## Overdue invoices\n* Acme: €40\n+ Globex: €95')).toBe(
      '*Overdue invoices*\n- Acme: €40\n- Globex: €95',
    );
  });

  it('writes a link as its label followed by the address', () => {
    expect(format_whatsapp_text('See [the invoice](https://pay.example.com/i/42).')).toBe(
      'See the invoice (https://pay.example.com/i/42).',
    );
    expect(format_whatsapp_text('[https://example.com](https://example.com)')).toBe(
      'https://example.com',
    );
  });

  it('leaves code untouched and drops the language name of a code block', () => {
    expect(
      format_whatsapp_text('Run `**not bold**` then\n```ts\nconst total = a * b * c;\n```'),
    ).toBe('Run `**not bold**` then\n```\nconst total = a * b * c;\n```');
  });

  it('keeps arithmetic and snake_case words as they are', () => {
    expect(format_whatsapp_text('2 * 3 * 4 for invoice_total')).toBe('2 * 3 * 4 for invoice_total');
  });
});

describe('split_whatsapp_text', () => {
  it('keeps a short reply in one message', () => {
    expect(split_whatsapp_text('Two invoices are overdue.')).toEqual(['Two invoices are overdue.']);
  });

  it('splits a long reply at a paragraph break inside the limit', () => {
    const paragraph = 'word '.repeat(30).trim();
    const chunks = split_whatsapp_text([paragraph, paragraph, paragraph].join('\n\n'), 320);

    expect(chunks).toEqual([`${paragraph}\n\n${paragraph}`, paragraph]);
  });

  it('cuts text that has no break at the limit', () => {
    expect(split_whatsapp_text('x'.repeat(25), 10)).toEqual([
      'x'.repeat(10),
      'x'.repeat(10),
      'x'.repeat(5),
    ]);
  });
});
