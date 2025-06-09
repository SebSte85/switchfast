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
    const {
      subscriptionId,
      email,
      cancelAtPeriodEnd = true,
    } = await req.json();
    if (!subscriptionId || !email) {
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
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe Secret Key nicht konfiguriert" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });
    // Stripe Subscription kündigen - REAKTIVIERBAR oder PERMANENT
    let canceledSub = null;
    try {
      if (cancelAtPeriodEnd) {
        // REAKTIVIERBARE Kündigung - Kunde kann bis zum Periodenende reaktivieren
        console.log(
          `Kündige Subscription ${subscriptionId} REAKTIVIERBAR (cancel_at_period_end: true)`
        );
        canceledSub = await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      } else {
        // PERMANENTE Kündigung - Subscription wird sofort beendet (Fallback)
        console.log(
          `Kündige Subscription ${subscriptionId} PERMANENT (sofort gelöscht)`
        );
        canceledSub = await stripe.subscriptions.del(subscriptionId);
      }
    } catch (err) {
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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
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
      console.log("Markiere Lizenz als reaktivierbar gekündigt");
    } else {
      // PERMANENTE Kündigung - Lizenz deaktivieren
      updateData = {
        is_active: false,
        cancelled_at: new Date().toISOString(),
        cancels_at_period_end: false,
      };
      console.log("Deaktiviere Lizenz permanent");
    }

    const { error: updateError } = await supabaseClient
      .from("licenses")
      .update(updateData)
      .eq("stripe_subscription_id", subscriptionId)
      .eq("email", email);
    if (updateError) {
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
    return new Response(JSON.stringify({ success: true, canceledSub }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Unerwarteter Fehler", details: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
