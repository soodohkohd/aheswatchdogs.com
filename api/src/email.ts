import { InvocationContext } from '@azure/functions';
import { EmailClient } from '@azure/communication-email';

/**
 * Email sending via Azure Communication Services (ACS) Email.
 *
 * ACS lives in *our* Azure subscription (resource group `ahes`), so sending
 * does NOT depend on the Microsoft 365 tenant that hosts the support@ mailbox
 * (GoDaddy-managed M365 blocks the Entra app registration that Graph would
 * need). Ownership of the sending domain is proven via DNS, which we control.
 *
 * Sender: a send-only address on the verified domain. Replies are routed to the
 * real mailbox via Reply-To (MAIL_REPLY_TO) — inbound mail still flows to M365.
 *
 * Required app settings (see local.settings.sample.json / CLAUDE.md):
 *   ACS_CONNECTION_STRING, MAIL_SENDER   (MAIL_REPLY_TO optional)
 *
 * **Local dev:** if ACS_CONNECTION_STRING is absent, sending is skipped and the
 * email (including any link) is logged to the console — so the verification
 * flow can be exercised end-to-end against Azurite without provisioning email.
 */

let cachedClient: EmailClient | undefined;

interface EmailConfig {
  connectionString: string;
  sender: string;
  appleSender?: string;
  replyTo?: string;
}

/** Read ACS config from env, or null if not configured (→ dev-log mode). */
function emailConfig(): EmailConfig | null {
  const connectionString = process.env['ACS_CONNECTION_STRING'];
  const sender = process.env['MAIL_SENDER'];
  if (!connectionString || !sender) return null;
  return {
    connectionString,
    sender,
    appleSender: process.env['MAIL_SENDER_APPLE'] || undefined,
    replyTo: process.env['MAIL_REPLY_TO'] || undefined,
  };
}

/**
 * Apple/iCloud mail domains. **Temporary deliverability workaround:** iCloud is
 * very slow to trust a brand-new sending domain (it silently drops cold-domain
 * mail), so until `mail.aheswatchdogs.com` warms up we send to these recipients
 * from the already-warmed Azure-managed domain (`MAIL_SENDER_APPLE`, the
 * `…azurecomm.net` address) which reaches iCloud reliably. Everyone else gets
 * the branded sender. Remove this once iCloud accepts the branded domain.
 */
const APPLE_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);

function pickSender(to: string, config: EmailConfig): string {
  const domain = to.split('@')[1]?.toLowerCase() ?? '';
  if (config.appleSender && APPLE_DOMAINS.has(domain)) return config.appleSender;
  return config.sender;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Send an email. Returns true if actually sent via ACS, false if it was
 *  logged only (dev mode / unconfigured). Throws on a real send failure so
 *  callers can surface "couldn't send" to the user. */
export async function sendEmail(message: EmailMessage, context: InvocationContext): Promise<boolean> {
  const config = emailConfig();
  if (!config) {
    context.log(
      `[email] ACS not configured — logging instead of sending.\n` +
        `  To: ${message.to}\n  Subject: ${message.subject}\n  ${message.text}`,
    );
    return false;
  }

  cachedClient ??= new EmailClient(config.connectionString);
  const senderAddress = pickSender(message.to, config);
  const poller = await cachedClient.beginSend({
    senderAddress,
    content: {
      subject: message.subject,
      html: message.html,
      plainText: message.text,
    },
    recipients: { to: [{ address: message.to }] },
    ...(config.replyTo ? { replyTo: [{ address: config.replyTo }] } : {}),
  });

  const result = await poller.pollUntilDone();
  if (result.status !== 'Succeeded') {
    throw new Error(`ACS send did not succeed: ${result.status} ${result.error?.message ?? ''}`);
  }
  return true;
}

/** Build + send the verification email. The link routes to the SPA's /verify
 *  page, which calls POST /api/verify with the id + token. */
export async function sendVerificationEmail(
  to: string,
  name: string,
  verifyUrl: string,
  context: InvocationContext,
): Promise<boolean> {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  const subject = 'Verify your email — AHES Watch D.O.G.S.';
  const text =
    `Hi ${firstName},\n\n` +
    `Thanks for signing up to be a Watch D.O.G.S. volunteer at Antelope Hills Elementary!\n\n` +
    `Please verify your email so you can sign up for days on campus:\n${verifyUrl}\n\n` +
    `This link expires in 7 days. If you didn't sign up, you can ignore this email.\n\n` +
    `— AHES Watch D.O.G.S.`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#222;line-height:1.5">
    <p style="font-size:1.5rem;margin:0 0 .25rem">🐾 AHES Watch D.O.G.S.</p>
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Thanks for signing up to be a Watch D.O.G.S. volunteer at Antelope Hills Elementary! Please verify your email so you can sign up for days on campus.</p>
    <p style="margin:1.5rem 0">
      <a href="${escapeHtml(verifyUrl)}"
         style="background:#2f7d3a;color:#fff;text-decoration:none;padding:.7rem 1.3rem;border-radius:999px;font-weight:700;display:inline-block">
        Verify my email
      </a>
    </p>
    <p style="font-size:.85rem;color:#555">Or paste this link into your browser:<br>
      <a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a>
    </p>
    <p style="font-size:.85rem;color:#555">This link expires in 7 days. If you didn't sign up, you can ignore this email.</p>
    <p style="font-size:.85rem;color:#555">— AHES Watch D.O.G.S.</p>
  </div>`;

  return sendEmail({ to, subject, html, text }, context);
}

/** Build + send the passwordless login code email. */
export async function sendLoginCodeEmail(
  to: string,
  name: string,
  code: string,
  context: InvocationContext,
): Promise<boolean> {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  const subject = `Your AHES Watch D.O.G.S. sign-in code: ${code}`;
  const text =
    `Hi ${firstName},\n\n` +
    `Your sign-in code for the Watch D.O.G.S. schedule is:\n\n  ${code}\n\n` +
    `Enter it on the schedule page to sign in. It expires in 10 minutes.\n` +
    `If you didn't request this, you can ignore this email.\n\n` +
    `— AHES Watch D.O.G.S.`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#222;line-height:1.5">
    <p style="font-size:1.5rem;margin:0 0 .25rem">🐾 AHES Watch D.O.G.S.</p>
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Your sign-in code for the Watch D.O.G.S. schedule is:</p>
    <p style="font-size:2rem;font-weight:700;letter-spacing:0.3em;background:#e7f2e9;color:#1f5a29;padding:.75rem 1rem;border-radius:10px;text-align:center;margin:1.25rem 0">${escapeHtml(code)}</p>
    <p style="font-size:.9rem;color:#555">Enter it on the schedule page to sign in. It expires in <b>10 minutes</b>.</p>
    <p style="font-size:.85rem;color:#555">If you didn't request this, you can ignore this email.</p>
    <p style="font-size:.85rem;color:#555">— AHES Watch D.O.G.S.</p>
  </div>`;

  return sendEmail({ to, subject, html, text }, context);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
