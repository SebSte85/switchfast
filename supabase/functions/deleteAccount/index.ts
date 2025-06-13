import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment",
};

function getEnvironment(req: Request): string {
  const envHeader = req.headers.get("x-environment");
  if (envHeader === "test" || envHeader === "prod") return envHeader;
  const url = new URL(req.url);
  const envParam = url.searchParams.get("env");
  if (envParam === "test" || envParam === "prod") return envParam;
  return Deno.env.get("ACTIVE_ENVIRONMENT") || "test";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const environment = getEnvironment(req);
    console.log(`🟢 Using environment: ${environment}`);

    const schema = environment === "prod" ? "prod" : "test";
    console.log(`🟢 Using schema: ${schema}`);

    const { email } = await req.json();

    console.log(`🟢 Request data:`, {
      email: email || "MISSING",
    });

    if (!email) {
      console.log(`🔴 ERROR: Missing email`);
      return new Response(JSON.stringify({ error: "email ist erforderlich" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    console.log(
      `🟢 Starting GDPR-compliant account deletion for email: ${email}`
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log(`🟢 Supabase config:`, {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!supabaseServiceKey,
      schema: schema,
    });

    const supabaseClient = createClient(
      supabaseUrl ?? "",
      supabaseServiceKey ?? "",
      { db: { schema } }
    );

    // Stripe-Konfiguration basierend auf der Umgebung
    const stripeSecretKey =
      environment === "prod"
        ? Deno.env.get("PROD_STRIPE_SECRET_KEY")
        : Deno.env.get("TEST_STRIPE_SECRET_KEY");

    console.log(`🟢 Stripe config:`, {
      environment: environment,
      hasSecretKey: !!stripeSecretKey,
      secretKeyPrefix: stripeSecretKey?.substring(0, 10) || "MISSING",
    });

    if (!stripeSecretKey) {
      console.log(
        `🔴 ERROR: Stripe secret key not found for environment: ${environment}`
      );
      return new Response(
        JSON.stringify({
          error: "Stripe-Konfiguration fehlt",
          details: `Keine Stripe-Konfiguration für Umgebung ${environment} gefunden`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });
    console.log(`🟢 Stripe client initialized`);

    // 1. Alle Lizenzen des Users mit Stripe-Informationen abrufen
    console.log(`🔍 Searching for licenses for email: ${email}`);
    const { data: licenses, error: licenseError } = await supabaseClient
      .from("licenses")
      .select("id, stripe_subscription_id, stripe_customer_id, email")
      .eq("email", email);

    if (licenseError) {
      console.log(`🔴 ERROR: Failed to find licenses`, { licenseError });
      return new Response(
        JSON.stringify({
          error: "Fehler beim Finden der Lizenzen",
          details: licenseError.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(`🟢 Found ${licenses?.length || 0} licenses for user`);

    // Variable für Device-Namen (für Email)
    let deviceNames: string[] = [];

    let gdprNotice = {
      stripe_data_notice:
        "⚠️ GDPR Notice: Due to financial regulations (AML/KYC), Stripe retains transaction history, payment intents, and charges for legal compliance. These records are anonymized but not deleted.",
      what_remains_in_stripe: [
        "Transaction records (anonymized)",
        "Payment history (customer data removed)",
        "Financial compliance records",
        "Event logs (personal data redacted)",
      ],
      what_gets_deleted: [
        "Customer profile",
        "Personal information",
        "Saved payment methods",
        "Customer metadata",
      ],
    };

    // 2. Umfassende Stripe-Bereinigung
    if (licenses && licenses.length > 0) {
      console.log(`🟢 Processing ${licenses.length} licenses for cleanup`);
      for (const license of licenses) {
        // 2a. Subscription stornieren falls vorhanden
        if (license.stripe_subscription_id) {
          try {
            console.log(
              `🟡 Cancelling Stripe subscription: ${license.stripe_subscription_id.substring(
                0,
                20
              )}...`
            );
            await stripe.subscriptions.cancel(license.stripe_subscription_id);
            console.log(`🟢 Stripe subscription cancelled successfully`);
          } catch (stripeError) {
            console.log(`🔴 ERROR: Failed to cancel subscription`, {
              subscriptionId: license.stripe_subscription_id,
              error: stripeError.message,
            });
            // Fortfahren, auch wenn Subscription-Stornierung fehlschlägt
          }
        }

        // 2b. Customer-Daten in Stripe anonymisieren/löschen
        if (license.stripe_customer_id) {
          try {
            console.log(
              `🟡 Anonymizing Stripe customer data: ${license.stripe_customer_id.substring(
                0,
                20
              )}...`
            );

            // Erst alle Payment Methods des Customers löschen
            try {
              console.log(`🔍 Fetching payment methods for customer`);
              const paymentMethods = await stripe.paymentMethods.list({
                customer: license.stripe_customer_id,
              });

              console.log(
                `🟢 Found ${paymentMethods.data.length} payment methods`
              );
              for (const pm of paymentMethods.data) {
                await stripe.paymentMethods.detach(pm.id);
                console.log(
                  `🟢 Detached payment method: ${pm.id.substring(0, 15)}...`
                );
              }
            } catch (pmError) {
              console.log(`🔴 ERROR: Failed to detach payment methods`, {
                pmError: pmError.message,
              });
            }

            // Customer-Daten anonymisieren BEVOR wir löschen
            try {
              console.log(`🟡 Anonymizing customer data`);
              await stripe.customers.update(license.stripe_customer_id, {
                name: "[DELETED USER]",
                email: null,
                phone: null,
                description: "Account deleted - GDPR compliance",
                metadata: {}, // Alle Metadata löschen
                address: {
                  line1: null,
                  line2: null,
                  city: null,
                  country: null,
                  postal_code: null,
                  state: null,
                },
                shipping: null,
              });
              console.log(`🟢 Customer data anonymized successfully`);
            } catch (updateError) {
              console.log(`🔴 ERROR: Failed to anonymize customer data`, {
                updateError: updateError.message,
              });
            }

            // Dann Customer löschen (soweit möglich)
            console.log(`🟡 Deleting Stripe customer`);
            await stripe.customers.del(license.stripe_customer_id);
            console.log(`🟢 Stripe customer deleted successfully`);
          } catch (stripeError) {
            console.log(`🔴 ERROR: Failed to process customer`, {
              customerId: license.stripe_customer_id,
              error: stripeError.message,
            });
            // Fortfahren, auch wenn Customer-Verarbeitung fehlschlägt
          }
        }
      }

      // 3. Device-Namen sammeln BEVOR wir die Activations löschen (für Email)
      if (licenses && licenses.length > 0) {
        const licenseIds = licenses.map((l: any) => l.id);
        const { data: deviceActivations } = await supabaseClient
          .from("device_activations")
          .select("device_name")
          .in("license_id", licenseIds);

        if (deviceActivations && deviceActivations.length > 0) {
          deviceNames = deviceActivations
            .map((d) => d.device_name)
            .filter((name) => name && name.trim() !== "");
        }
      }

      // 4. Alle Device Activations löschen (DSGVO: Geräte-IDs sind personenbezogene Daten)
      const licenseIds = licenses.map((l: any) => l.id);
      console.log(
        `🗑️ [DELETE ACCOUNT] Deleting device activations for ${licenseIds.length} licenses`
      );

      const { error: deviceError } = await supabaseClient
        .from("device_activations")
        .delete()
        .in("license_id", licenseIds);

      if (deviceError) {
        console.error(
          "❌ [DELETE ACCOUNT] Error deleting device activations:",
          deviceError
        );
        return new Response(
          JSON.stringify({
            error: "Fehler beim Löschen der Gerätedaten",
            details: deviceError.message,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }
      console.log(`✅ [DELETE ACCOUNT] Device activations deleted`);
    }

    // 5. Trial Blocks löschen (DSGVO: Device-ID und Privacy Consent sind personenbezogene Daten)
    if (licenses && licenses.length > 0) {
      // Erst alle Device-IDs sammeln die zu diesem User gehören
      const { data: userDevices, error: deviceQueryError } =
        await supabaseClient
          .from("device_activations")
          .select("device_id")
          .in(
            "license_id",
            licenses.map((l) => l.id)
          );

      if (!deviceQueryError && userDevices && userDevices.length > 0) {
        const deviceIds = userDevices.map((d) => d.device_id);
        console.log(
          `🗑️ [DELETE ACCOUNT] Deleting trial blocks for ${deviceIds.length} devices`
        );

        const { error: trialError } = await supabaseClient
          .from("trial_blocks")
          .delete()
          .in("device_id", deviceIds);

        if (trialError) {
          console.error(
            "❌ [DELETE ACCOUNT] Error deleting trial blocks:",
            trialError
          );
        } else {
          console.log(`✅ [DELETE ACCOUNT] Trial blocks deleted`);
        }
      }
    }

    // 6. Lizenzen anonymisieren/löschen (DSGVO: E-Mail ist personenbezogener Daten)
    console.log(`🗑️ [DELETE ACCOUNT] Anonymizing licenses`);
    const { error: updateError } = await supabaseClient
      .from("licenses")
      .update({
        email: null,
        is_active: false,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_payment_id: null,
      })
      .eq("email", email);

    if (updateError) {
      console.error(
        "❌ [DELETE ACCOUNT] Error anonymizing licenses:",
        updateError
      );
      return new Response(
        JSON.stringify({
          error: "Fehler beim Anonymisieren der Lizenzdaten",
          details: updateError.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(
      `✅ [DELETE ACCOUNT] GDPR-compliant account deletion completed for email: ${email}`
    );

    // 7. Send account deletion confirmation email
    try {
      console.log("🟢 Sending account deletion confirmation email...");
      const deletionEmailResponse = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/sendAccountDeletionEmail`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email,
            deviceName: deviceNames.length > 0 ? deviceNames[0] : undefined,
          }),
        }
      );

      if (deletionEmailResponse.ok) {
        console.log("✅ Account deletion email sent successfully");
      } else {
        console.log(
          "🔴 Failed to send account deletion email:",
          await deletionEmailResponse.text()
        );
      }
    } catch (emailError) {
      console.log("🔴 Error sending account deletion email:", emailError);
      // Continue with account deletion even if email fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Account successfully deleted with GDPR compliance",
        details: {
          licenses_anonymized: licenses?.length || 0,
          subscriptions_cancelled:
            licenses?.filter((l) => l.stripe_subscription_id).length || 0,
          customers_processed:
            licenses?.filter((l) => l.stripe_customer_id).length || 0,
        },
        gdpr_compliance: gdprNotice,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("💥 [DELETE ACCOUNT] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Unerwarteter Fehler", details: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
