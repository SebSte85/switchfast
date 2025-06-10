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

    const {
      subscriptionId,
      email,
      cancelAtPeriodEnd = true,
    } = await req.json();

    console.log(`🟢 Request data:`, {
      hasSubscriptionId: !!subscriptionId,
      subscriptionIdPrefix: subscriptionId?.substring(0, 20) || "MISSING",
      email: email || "MISSING",
      cancelAtPeriodEnd: cancelAtPeriodEnd,
    });

    if (!subscriptionId || !email) {
      console.log(`🔴 ERROR: Missing required fields`, {
        hasSubscriptionId: !!subscriptionId,
        hasEmail: !!email,
      });
      return new Response(
        JSON.stringify({ error: "subscriptionId und email sind erforderlich" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

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
        `🔴 ERROR: Stripe Secret Key not configured for environment: ${environment}`
      );
      return new Response(
        JSON.stringify({ error: "Stripe Secret Key nicht konfiguriert" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });
    console.log(`🟢 Stripe client initialized`);

    // Stripe Subscription kündigen - REAKTIVIERBAR oder PERMANENT
    let canceledSub = null;
    try {
      if (cancelAtPeriodEnd) {
        // REAKTIVIERBARE Kündigung - Kunde kann bis zum Periodenende reaktivieren
        console.log(
          `🟡 Canceling subscription ${subscriptionId.substring(
            0,
            20
          )}... as REACTIVATABLE (cancel_at_period_end: true)`
        );
        canceledSub = await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      } else {
        // PERMANENTE Kündigung - Subscription wird sofort beendet (Fallback)
        console.log(
          `🔴 Canceling subscription ${subscriptionId.substring(
            0,
            20
          )}... as PERMANENT (immediate deletion)`
        );
        canceledSub = await stripe.subscriptions.del(subscriptionId);
      }
      console.log(`🟢 Subscription canceled successfully`, {
        subscriptionId: canceledSub.id,
        status: canceledSub.status,
        cancelAtPeriodEnd: canceledSub.cancel_at_period_end,
      });
    } catch (err) {
      console.log(`🔴 ERROR: Failed to cancel subscription`, {
        subscriptionId: subscriptionId,
        error: err.message,
        cancelAtPeriodEnd: cancelAtPeriodEnd,
      });
      return new Response(
        JSON.stringify({
          error: "Fehler beim Kündigen der Subscription",
          details: err.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Supabase Lizenz entsprechend aktualisieren
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

    let updateData: any;
    if (cancelAtPeriodEnd) {
      // REAKTIVIERBARE Kündigung - Lizenz bleibt aktiv, aber mit Kanzellierungsmarkierungen
      updateData = {
        cancelled_at: new Date().toISOString(),
        cancels_at_period_end: true,
        // is_active bleibt true, da die Subscription bis zum Periodenende läuft
      };
      console.log(`🟡 Marking license as reactivatable canceled`);
    } else {
      // PERMANENTE Kündigung - Lizenz deaktivieren
      updateData = {
        is_active: false,
        cancelled_at: new Date().toISOString(),
        cancels_at_period_end: false,
      };
      console.log(`🔴 Deactivating license permanently`);
    }

    console.log(`🔍 Updating license in database:`, {
      subscriptionId: subscriptionId.substring(0, 20) + "...",
      email: email,
      updateData: updateData,
    });

    const { error: updateError } = await supabaseClient
      .from("licenses")
      .update(updateData)
      .eq("stripe_subscription_id", subscriptionId)
      .eq("email", email);

    if (updateError) {
      console.log(`🔴 ERROR: Failed to update license`, {
        updateError: updateError.message,
        subscriptionId: subscriptionId,
        email: email,
      });
      return new Response(
        JSON.stringify({
          error: "Fehler beim Aktualisieren der Lizenz",
          details: updateError.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(`🟢 License updated successfully`);
    console.log(`🟢 Subscription cancellation completed successfully`);

    return new Response(JSON.stringify({ success: true, canceledSub }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.log(`🔴 ERROR: Unexpected error occurred`, {
      error: error.message,
      stack: error.stack,
    });
    return new Response(
      JSON.stringify({ error: "Unerwarteter Fehler", details: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
