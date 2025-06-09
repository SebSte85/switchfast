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
    const schema = environment === "prod" ? "prod" : "test";
    const { email } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "email ist erforderlich" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    console.log(
      `🗑️ [DELETE ACCOUNT] Starting GDPR-compliant account deletion for email: ${email} in environment: ${environment}`
    );

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { db: { schema } }
    );

    // Stripe-Konfiguration basierend auf der Umgebung
    const stripeSecretKey =
      environment === "prod"
        ? Deno.env.get("PROD_STRIPE_SECRET_KEY")
        : Deno.env.get("TEST_STRIPE_SECRET_KEY");

    if (!stripeSecretKey) {
      console.error(
        "⚠️ [DELETE ACCOUNT] Stripe secret key not found for environment:",
        environment
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

    // 1. Alle Lizenzen des Users mit Stripe-Informationen abrufen
    const { data: licenses, error: licenseError } = await supabaseClient
      .from("licenses")
      .select("id, stripe_subscription_id, stripe_customer_id, email")
      .eq("email", email);

    if (licenseError) {
      console.error(
        "❌ [DELETE ACCOUNT] Error finding licenses:",
        licenseError
      );
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

    console.log(
      `📊 [DELETE ACCOUNT] Found ${licenses?.length || 0} licenses for user`
    );

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
      for (const license of licenses) {
        // 2a. Subscription stornieren falls vorhanden
        if (license.stripe_subscription_id) {
          try {
            console.log(
              `🚫 [DELETE ACCOUNT] Cancelling Stripe subscription: ${license.stripe_subscription_id}`
            );
            await stripe.subscriptions.cancel(license.stripe_subscription_id);
            console.log(
              `✅ [DELETE ACCOUNT] Stripe subscription cancelled: ${license.stripe_subscription_id}`
            );
          } catch (stripeError) {
            console.error(
              `⚠️ [DELETE ACCOUNT] Failed to cancel subscription ${license.stripe_subscription_id}:`,
              stripeError
            );
            // Fortfahren, auch wenn Subscription-Stornierung fehlschlägt
          }
        }

        // 2b. Customer-Daten in Stripe anonymisieren/löschen
        if (license.stripe_customer_id) {
          try {
            console.log(
              `🔄 [DELETE ACCOUNT] Anonymizing Stripe customer data: ${license.stripe_customer_id}`
            );

            // Erst alle Payment Methods des Customers löschen
            try {
              const paymentMethods = await stripe.paymentMethods.list({
                customer: license.stripe_customer_id,
              });

              for (const pm of paymentMethods.data) {
                await stripe.paymentMethods.detach(pm.id);
                console.log(
                  `🗑️ [DELETE ACCOUNT] Detached payment method: ${pm.id}`
                );
              }
            } catch (pmError) {
              console.error(
                `⚠️ [DELETE ACCOUNT] Error detaching payment methods:`,
                pmError
              );
            }

            // Customer-Daten anonymisieren BEVOR wir löschen
            try {
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
              console.log(
                `🔒 [DELETE ACCOUNT] Customer data anonymized: ${license.stripe_customer_id}`
              );
            } catch (updateError) {
              console.error(
                `⚠️ [DELETE ACCOUNT] Failed to anonymize customer data:`,
                updateError
              );
            }

            // Dann Customer löschen (soweit möglich)
            await stripe.customers.del(license.stripe_customer_id);
            console.log(
              `✅ [DELETE ACCOUNT] Stripe customer deleted: ${license.stripe_customer_id}`
            );
          } catch (stripeError) {
            console.error(
              `⚠️ [DELETE ACCOUNT] Failed to process customer ${license.stripe_customer_id}:`,
              stripeError
            );
            // Fortfahren, auch wenn Customer-Verarbeitung fehlschlägt
          }
        }
      }

      // 3. Alle Device Activations löschen (DSGVO: Geräte-IDs sind personenbezogene Daten)
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

    // 4. Trial Blocks löschen (DSGVO: Device-ID und Privacy Consent sind personenbezogene Daten)
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

    // 5. Lizenzen anonymisieren/löschen (DSGVO: E-Mail ist personenbezogener Daten)
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
