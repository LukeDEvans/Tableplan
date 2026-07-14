// Receives Gmail push notifications via Google Cloud Pub/Sub.
// Pub/Sub POSTs { message: { data: base64({ emailAddress, historyId }) } }
// whenever new mail arrives for a watched inbox. The actual sweep is handed
// to sweep-background (15-minute limit) because AI newsletter conversion
// blows this function's ~26s budget. Always ACK (200) — returning an error
// makes Pub/Sub retry aggressively, and our checkpoint means a missed
// notification is recovered by the next one anyway.
const { findGmailUserByEmail } = require("./_gmail-shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };

  const expected = (process.env.PUBSUB_VERIFICATION_TOKEN || "").trim();
  const provided = event.queryStringParameters?.token || "";
  if (!expected || provided !== expected) return { statusCode: 403, body: "" };

  let notif;
  try {
    const body = JSON.parse(event.body || "{}");
    notif = JSON.parse(Buffer.from(body.message.data, "base64").toString());
  } catch {
    console.error("gmail-webhook: malformed Pub/Sub payload");
    return { statusCode: 200, body: "" };
  }

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!serviceKey || !anthropicKey) {
    console.error("gmail-webhook: missing SUPABASE_SERVICE_ROLE_KEY or ANTHROPIC_API_KEY");
    return { statusCode: 200, body: "" };
  }

  const user = await findGmailUserByEmail(serviceKey, notif.emailAddress);
  if (!user) {
    console.error("gmail-webhook: no connected user for", notif.emailAddress);
    return { statusCode: 200, body: "" };
  }

  try {
    // Background functions ACK with 202 immediately and keep running
    const base = (process.env.URL || "").replace(/\/$/, "");
    await fetch(`${base}/.netlify/functions/sweep-background?token=${encodeURIComponent(expected)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: notif.emailAddress })
    });
  } catch (e) {
    console.error("gmail-webhook: could not start background sweep:", e.message);
  }
  return { statusCode: 200, body: "" };
};
