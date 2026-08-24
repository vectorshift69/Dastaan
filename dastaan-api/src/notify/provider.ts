/* ------------------------------------------------------------------ */
/* SMS providers — pluggable via SMS_PROVIDER env.                     */
/*   console : dev default; "delivery" is logging (outbox row is the   */
/*             source of truth either way)                             */
/*   twilio  : real SMS via Twilio REST API (set TWILIO_* in env)      */
/* WhatsApp Business (often preferred in UAE) slots in the same way —  */
/* add a provider hitting the WhatsApp Cloud API when the number is    */
/* approved.                                                           */
/* ------------------------------------------------------------------ */

export interface SmsProvider {
  name: string;
  send(toPhone: string, body: string): Promise<void>; // throws on failure
}

class ConsoleProvider implements SmsProvider {
  name = "console";
  async send(toPhone: string, body: string) {
    console.log(`[sms→${toPhone}] ${body}`);
  }
}

class TwilioProvider implements SmsProvider {
  name = "twilio";
  constructor(
    private sid: string,
    private token: string,
    private from: string
  ) {}
  async send(toPhone: string, body: string) {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${this.sid}:${this.token}`).toString("base64"),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: toPhone.replace(/\s+/g, ""),
          From: this.from,
          Body: body,
        }),
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio ${res.status}: ${detail.slice(0, 200)}`);
    }
  }
}

export function makeProvider(): SmsProvider {
  if (process.env.SMS_PROVIDER === "twilio") {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } =
      process.env;
    if (!sid || !token || !from)
      throw new Error("SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM");
    return new TwilioProvider(sid, token, from);
  }
  return new ConsoleProvider();
}

/* ------------------------------------------------------------------ */
/* Email — same shape, same outbox, different destination.             */
/*                                                                     */
/* Needed because a password reset link cannot go by SMS: it is long,  */
/* and the address is the thing being proved. The console provider is  */
/* the dev default and prints the link, which is enough to test the    */
/* whole flow with nothing configured.                                 */
/*                                                                     */
/* Resend is the real one because it needs no SDK — a single POST with */
/* a bearer token. Swap in SES or Postmark the same way.               */
/* ------------------------------------------------------------------ */

export interface EmailProvider {
  name: string;
  send(to: string, subject: string, body: string): Promise<void>; // throws on failure
}

class ConsoleEmailProvider implements EmailProvider {
  name = "console";
  async send(to: string, subject: string, body: string) {
    console.log(`[email→${to}] ${subject}\n${body}`);
  }
}

class ResendProvider implements EmailProvider {
  name = "resend";
  constructor(private key: string, private from: string) {}
  async send(to: string, subject: string, body: string) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: this.from, to, subject, text: body }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
    }
  }
}

export function makeEmailProvider(): EmailProvider {
  if (process.env.EMAIL_PROVIDER === "resend") {
    const { RESEND_API_KEY: key, EMAIL_FROM: from } = process.env;
    if (!key || !from)
      throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY and EMAIL_FROM");
    return new ResendProvider(key, from);
  }
  return new ConsoleEmailProvider();
}
