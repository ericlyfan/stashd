import { readFile } from 'fs/promises';
import { extensionOf } from '@stashd/shared';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export interface ParsedEmail {
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  bodyText: string;
  attachments: EmailAttachment[];
}

// Last-resort tag strip for HTML-only emails (mailparser usually gives a text
// part already). Not a full HTML→text converter.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function parseEml(filePath: string): Promise<ParsedEmail> {
  const { simpleParser } = await import('mailparser');
  const mail = await simpleParser(await readFile(filePath));
  const addrText = (a: unknown): string | undefined =>
    Array.isArray(a)
      ? a.map(x => (x as { text?: string }).text).filter(Boolean).join(', ')
      : (a as { text?: string } | undefined)?.text;
  const attachments: EmailAttachment[] = (mail.attachments ?? [])
    .filter(a => a.content && a.filename)
    .map(a => ({ filename: a.filename as string, content: a.content as Buffer }));
  return {
    subject: mail.subject,
    from: addrText(mail.from),
    to: addrText(mail.to),
    date: mail.date?.toISOString(),
    bodyText: mail.text ?? (mail.html ? htmlToText(mail.html) : ''),
    attachments,
  };
}

// msgreader is CJS with under-described typings (and, under Node16 interop, the
// class lands one `.default` deeper than its types claim). Type what we use.
interface MsgFileData {
  subject?: string;
  body?: string;
  senderName?: string;
  senderEmail?: string;
  messageDeliveryTime?: string;
  recipients?: { name?: string; email?: string }[];
  attachments?: unknown[];
}
interface MsgReaderInstance {
  getFileData(): MsgFileData;
  getAttachment(attach: number): { fileName?: string; content?: Uint8Array };
}
type MsgReaderCtor = new (input: ArrayBuffer | DataView) => MsgReaderInstance;

async function parseMsg(filePath: string): Promise<ParsedEmail> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import('@kenjiuno/msgreader')) as any;
  const MsgReader = (typeof mod.default === 'function' ? mod.default : mod.default.default) as MsgReaderCtor;

  const buf = await readFile(filePath);
  const reader = new MsgReader(new DataView(buf.buffer, buf.byteOffset, buf.byteLength));
  const data = reader.getFileData();

  const attachments: EmailAttachment[] = (data.attachments ?? []).flatMap((_att, i) => {
    const file = reader.getAttachment(i);
    if (!file?.content) return [];
    return [{ filename: file.fileName || `attachment-${i + 1}`, content: Buffer.from(file.content) }];
  });
  const to = (data.recipients ?? []).map(r => r.email || r.name).filter(Boolean).join(', ');
  const from = data.senderEmail
    ? `${data.senderName ?? ''} <${data.senderEmail}>`.trim()
    : data.senderName;
  return {
    subject: data.subject,
    from,
    to: to || undefined,
    date: data.messageDeliveryTime,
    bodyText: data.body ?? '',
    attachments,
  };
}

// Parse an .eml or .msg file. Never throws — a parse failure yields undefined
// so callers degrade to "no text / no attachments".
export async function parseEmail(filePath: string): Promise<ParsedEmail | undefined> {
  try {
    const ext = extensionOf(filePath);
    if (ext === 'eml') return await parseEml(filePath);
    if (ext === 'msg') return await parseMsg(filePath);
    return undefined;
  } catch {
    return undefined;
  }
}

// Flatten a parsed email into searchable text: header lines, then the body,
// with the attachment filenames noted so they turn up in search too.
export function emailToText(email: ParsedEmail): string {
  const head: string[] = [];
  if (email.from) head.push(`From: ${email.from}`);
  if (email.to) head.push(`To: ${email.to}`);
  if (email.date) head.push(`Date: ${email.date}`);
  if (email.subject) head.push(`Subject: ${email.subject}`);
  if (email.attachments.length) {
    head.push(`Attachments: ${email.attachments.map(a => a.filename).join(', ')}`);
  }
  return [...head, '', email.bodyText].join('\n');
}
