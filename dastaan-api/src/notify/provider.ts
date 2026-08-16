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
