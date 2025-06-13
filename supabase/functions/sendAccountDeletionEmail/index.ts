import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment",
};

// AWS SES configuration
const AWS_REGION = "eu-west-1";
const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");

// Company footer for emails
const COMPANY_FOOTER = `

---
DigITup GmbH - Königsallee 27 - 40212 Düsseldorf - Germany
www.switchfast.io`;

// AWS Signature V4 implementation
async function createAwsSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: string,
  service: string = "ses"
): Promise<string> {
  const encoder = new TextEncoder();

  // Parse URL
  const urlObj = new URL(url);
  const canonicalUri = urlObj.pathname || "/";
  const canonicalQueryString = urlObj.search ? urlObj.search.slice(1) : "";

  // Create canonical headers
  const sortedHeaders = Object.entries(headers)
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([key, value]) => `${key.toLowerCase()}:${value.trim()}`)
    .join("\n");

  const signedHeaders = Object.keys(headers)
    .sort()
    .map((key) => key.toLowerCase())
    .join(";");

  // Hash payload
  const payloadHash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(payload)
  );
  const payloadHashHex = Array.from(new Uint8Array(payloadHash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Create canonical request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    sortedHeaders,
    "",
    signedHeaders,
    payloadHashHex,
  ].join("\n");

  // Create string to sign
  const algorithm = "AWS4-HMAC-SHA256";
  const amzDate = headers["x-amz-date"] || headers["X-Amz-Date"];
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${AWS_REGION}/${service}/aws4_request`;

  const canonicalRequestHash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(canonicalRequest)
  );
  const canonicalRequestHashHex = Array.from(
    new Uint8Array(canonicalRequestHash)
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    canonicalRequestHashHex,
  ].join("\n");

  // Create signing key
  async function hmacSha256(
    key: ArrayBuffer | Uint8Array,
    data: string
  ): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  }

  const kDate = await hmacSha256(
    encoder.encode(`AWS4${AWS_SECRET_ACCESS_KEY}`),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, AWS_REGION);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");

  // Create signature
  const signature = await hmacSha256(kSigning, stringToSign);
  const signatureHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${algorithm} Credential=${AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signatureHex}`;
}

// Send email via AWS SES v2
async function sendEmailViaSES(
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string
) {
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS credentials not configured");
  }

  const sesEndpoint = `https://email.${AWS_REGION}.amazonaws.com/v2/email/outbound-emails`;

  // Create the request payload for SES v2
  const payload = JSON.stringify({
    FromEmailAddress: fromEmail,
    Destination: {
      ToAddresses: [toEmail],
    },
    Content: {
      Simple: {
        Subject: {
          Data: subject,
          Charset: "UTF-8",
        },
        Body: {
          Text: {
            Data: body,
            Charset: "UTF-8",
          },
        },
      },
    },
    ConfigurationSetName: "switchfast-config",
  });

  // Create timestamp
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");

  // Create headers
  const headers = {
    "Content-Type": "application/x-amz-json-1.0",
    "X-Amz-Target": "SimpleEmailService_v2.SendEmail",
    Host: `email.${AWS_REGION}.amazonaws.com`,
    "X-Amz-Date": amzDate,
  };

  // Create authorization header
  const authorization = await createAwsSignature(
    "POST",
    sesEndpoint,
    headers,
    payload,
    "ses"
  );
  headers["Authorization"] = authorization;

  console.log("📧 Sending email via AWS SES v2:", {
    from: fromEmail,
    to: toEmail,
    subject: subject,
    endpoint: sesEndpoint,
    configSet: "switchfast-config",
  });

  // Send request to SES
  const response = await fetch(sesEndpoint, {
    method: "POST",
    headers: headers,
    body: payload,
  });

  const responseText = await response.text();

  console.log("📧 SES Response:", {
    status: response.status,
    statusText: response.statusText,
    body: responseText.substring(0, 500),
  });

  if (!response.ok) {
    console.error("❌ SES Error Response:", responseText);
    throw new Error(
      `SES API Error: ${response.status} ${response.statusText} - ${responseText}`
    );
  }

  // Parse response
  let result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    result = { MessageId: `ses-${Date.now()}` };
  }

  return { success: true, messageId: result.MessageId || `ses-${Date.now()}` };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, deviceName } = await req.json();

    console.log("🟢 Account deletion email request:", {
      email: email || "MISSING",
      deviceName: deviceName || "MISSING",
    });

    // Validation
    if (!email) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields",
          details: "Email is required",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Prepare account deletion confirmation email content
    const deletionSubject = `Your switchfast account has been deleted`;
    const deletionBody = `
Hey there,

Your switchfast account and all associated data have been successfully deleted.

Here's what happened:
• Your license has been deactivated
• All personal data has been removed from our systems
• Your Stripe subscription (if any) has been cancelled
${deviceName ? `• Device "${deviceName}" has been unregistered` : ""}

This action is permanent and cannot be undone.

If you decide to use switchfast again in the future, you'll need to create a new account and purchase a new license.

Thanks for giving switchfast a try! If you have any feedback about why you decided to leave, I'd love to hear it - just reply to this email.

Best regards,
Sebastian

P.S. Sorry to see you go. Hope our paths cross again someday! 👋${COMPANY_FOOTER}
    `.trim();

    // Send account deletion confirmation email
    console.log("🟢 Sending account deletion email via AWS SES...");
    const result = await sendEmailViaSES(
      "noreply@switchfast.io",
      email,
      deletionSubject,
      deletionBody
    );

    console.log("✅ Account deletion email sent successfully:", result);
    return new Response(
      JSON.stringify({
        success: true,
        message: "Account deletion email sent successfully",
        messageId: result.messageId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("🔴 Account deletion email error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
