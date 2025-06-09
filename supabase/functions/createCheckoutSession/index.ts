import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment",
};

// Funktion zum Ermitteln der aktiven Umgebung
function getEnvironment(req: Request): string {
  // 1. Prüfen des x-environment Headers
  const envHeader = req.headers.get("x-environment");
  if (envHeader === "test" || envHeader === "prod") {
    return envHeader;
  }

  // 2. Prüfen des env Query-Parameters
  const url = new URL(req.url);
  const envParam = url.searchParams.get("env");
  if (envParam === "test" || envParam === "prod") {
    return envParam;
  }

  // 3. Fallback auf die Standardumgebung aus den Umgebungsvariablen
  const defaultEnv = Deno.env.get("ACTIVE_ENVIRONMENT") || "test";
  return defaultEnv;
}

serve(async (req) => {
  // CORS-Preflight-Anfragen behandeln
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Umgebung bestimmen
    const environment = getEnvironment(req);
    console.log(`Verwende Umgebung: ${environment}`);

    // Schema basierend auf der Umgebung auswählen
    const schema = environment === "prod" ? "prod" : "test";

    const { deviceId, deviceName, email } = await req.json();

    // Validierung der Eingaben
    if (!deviceId) {
      return new Response(
        JSON.stringify({
          error: "Geräte-ID ist erforderlich",
          userMessage:
            "Ein technischer Fehler ist aufgetreten. Bitte starten Sie die Anwendung neu und versuchen Sie es erneut.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Supabase-Client für Validierung initialisieren
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        db: {
          schema: schema,
        },
      }
    );

    // Stripe-Konfiguration basierend auf der Umgebung FRÜH initialisieren
    const stripeSecretKey =
      environment === "prod"
        ? Deno.env.get("PROD_STRIPE_SECRET_KEY")
        : Deno.env.get("TEST_STRIPE_SECRET_KEY");

    const priceId =
      environment === "prod"
        ? Deno.env.get("PROD_STRIPE_PRICE_ID")
        : Deno.env.get("TEST_STRIPE_PRICE_ID");

    if (!stripeSecretKey || !priceId) {
      return new Response(
        JSON.stringify({
          error: "Stripe-Konfiguration fehlt",
          userMessage:
            "Der Zahlungsservice ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // **NEU: Prüfung der Lizenz-Situation für diese Device-ID**
    console.log(
      `🔍 Suche nach Device-Aktivierungen für Device-ID: ${deviceId}`
    );

    const { data: existingActivations, error: activationError } =
      await supabaseClient
        .from("device_activations")
        .select(
          `
        id,
        is_active,
        license_id,
        licenses!inner(
          id,
          is_active,
          email,
          subscription_end_date,
          cancelled_at,
          cancels_at_period_end,
          stripe_subscription_id
        )
      `
        )
        .eq("device_id", deviceId)
        .eq("is_active", true);

    console.log("🔍 Gefundene Aktivierungen:", existingActivations);
    console.log("🔍 Aktivierungsfehler:", activationError);

    const existingActivation = existingActivations?.[0] || null;

    if (activationError) {
      console.error(
        "Fehler bei der Validierung bestehender Lizenzen:",
        activationError
      );
      return new Response(
        JSON.stringify({
          error: "Validierungsfehler",
          userMessage:
            "Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    if (existingActivation) {
      const license = existingActivation.licenses;
      const now = new Date();
      const subscriptionEndDate = license.subscription_end_date
        ? new Date(license.subscription_end_date)
        : null;

      // Prüfe, ob die Lizenz noch aktiv und nicht gecancelt ist
      const isActiveLicense =
        license.is_active &&
        subscriptionEndDate &&
        subscriptionEndDate > now &&
        !license.cancelled_at;

      if (isActiveLicense) {
        // Aktive, nicht-gecancelte Lizenz gefunden - Checkout verhindern
        return new Response(
          JSON.stringify({
            error: "DEVICE_ALREADY_LICENSED",
            userMessage: `Für dieses Gerät ist bereits eine aktive Lizenz registriert${
              license.email ? ` (${license.email})` : ""
            }. Jedes Gerät kann nur eine Lizenz haben. Falls Sie Probleme mit Ihrer bestehenden Lizenz haben, kontaktieren Sie bitte unseren Support.`,
            existingLicenseEmail: license.email,
            suggestions: [
              "Prüfen Sie, ob Sie bereits eine Lizenz gekauft haben",
              "Kontaktieren Sie unseren Support für Lizenz-Transfer",
              "Verwenden Sie ein anderes Gerät für eine neue Lizenz",
            ],
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 409,
          }
        );
      }

      // Prüfe, ob es sich um eine zur Kündigung geplante aber noch aktive Subscription handelt
      const isReactivatableSubscription =
        license.stripe_subscription_id &&
        license.cancels_at_period_end &&
        subscriptionEndDate &&
        subscriptionEndDate > now;

      console.log("🔍 Reactivation Check:", {
        stripe_subscription_id: license.stripe_subscription_id,
        cancels_at_period_end: license.cancels_at_period_end,
        subscription_end_date: subscriptionEndDate,
        now: now.toISOString(),
        isEndDateValid: subscriptionEndDate && subscriptionEndDate > now,
        isReactivatableSubscription,
      });

      if (isReactivatableSubscription) {
        console.log(
          `Zur Kündigung geplante aber noch aktive Subscription gefunden - versuche Reaktivierung durch Rücknahme von cancel_at_period_end`
        );
        console.log(`Ursprüngliche E-Mail: ${license.email}`);

        // Versuche Subscription zu reaktivieren anstatt neue zu erstellen
        try {
          const stripe = new Stripe(stripeSecretKey, {
            apiVersion: "2023-10-16",
          });

          // Hole die aktuelle Subscription von Stripe
          const currentSubscription = await stripe.subscriptions.retrieve(
            license.stripe_subscription_id
          );

          let reactivatedSubscription;

          if (
            currentSubscription.status === "active" &&
            currentSubscription.cancel_at_period_end
          ) {
            // Subscription ist für Ende der Periode geplant zu kündigen - das können wir rückgängig machen
            // Laut Stripe Docs: "You can reactivate subscriptions scheduled for cancellation by updating cancel_at_period_end to false"
            console.log(
              "Reaktiviere Subscription durch Rücknahme von cancel_at_period_end"
            );
            reactivatedSubscription = await stripe.subscriptions.update(
              license.stripe_subscription_id,
              {
                cancel_at_period_end: false,
              }
            );
          } else {
            // Subscription ist permanent gekündigt oder hat einen anderen Status
            // Laut Stripe Docs: "canceled" ist ein "terminal state that can't be updated"
            console.log(
              `Subscription-Status: ${currentSubscription.status}, cancel_at_period_end: ${currentSubscription.cancel_at_period_end} - kann nicht reaktiviert werden`
            );
            console.log("Erstelle neue Subscription mit bestehendem Kunden");
            throw new Error(
              "Subscription cannot be reactivated - create new one"
            );
          }

          console.log(
            `Subscription erfolgreich reaktiviert: ${reactivatedSubscription.id}`
          );

          // Update Supabase Datenbank - Kündigung rückgängig machen
          const { error: updateError } = await supabaseClient
            .from("licenses")
            .update({
              cancelled_at: null,
              cancels_at_period_end: false,
              is_active: true,
              updated_at: new Date().toISOString(),
            })
            .eq("id", license.id);

          if (updateError) {
            console.error(
              "Fehler beim Update der Lizenz in Supabase:",
              updateError
            );
          }

          // Reaktiviere auch die Device-Aktivierung
          const { error: deviceUpdateError } = await supabaseClient
            .from("device_activations")
            .update({
              is_active: true,
              last_check_in: new Date().toISOString(),
            })
            .eq("device_id", deviceId)
            .eq("license_id", license.id);

          if (deviceUpdateError) {
            console.error(
              "Fehler beim Update der Device-Aktivierung:",
              deviceUpdateError
            );
          }

          // Erfolgreiche Reaktivierung - DIREKTE REAKTIVIERUNG ohne Checkout
          return new Response(
            JSON.stringify({
              success: true,
              reactivated: true,
              message: "Subscription successfully reactivated! Welcome back!",
              subscription_id: reactivatedSubscription.id,
              subscription_end_date: license.subscription_end_date,
              customer_email: license.email,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            }
          );
        } catch (stripeError) {
          console.error("Fehler bei Subscription-Reaktivierung:", stripeError);
          // Falls Reaktivierung fehlschlägt, erstelle neue Subscription (Fallback)
        }
      }

      // Gefundene Lizenz ist permanent gecancelt oder Reaktivierung fehlgeschlagen
      // Für wirklich gekündigte Subscriptions (nicht nur cancel_at_period_end) erstelle neue Subscription
      console.log(
        `Permanent gekündigte Lizenz für Device ${deviceId} gefunden - erstelle neue Subscription`
      );
    }

    // Stripe-Client initialisieren
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });

    // URLs für Erfolg und Abbruch
    const baseSuccessUrl =
      Deno.env.get("STRIPE_SUCCESS_URL") || "switchfast://payment-success";
    const baseCancelUrl =
      Deno.env.get("STRIPE_CANCEL_URL") || "switchfast://payment-cancel";

    // Füge Umgebungsparameter zu den URLs hinzu
    const successUrl = `${baseSuccessUrl}${
      baseSuccessUrl.includes("?") ? "&" : "?"
    }env=${environment}`;
    const cancelUrl = `${baseCancelUrl}${
      baseCancelUrl.includes("?") ? "&" : "?"
    }env=${environment}`;

    // Checkout-Session erstellen
    const sessionConfig: any = {
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      // Wichtig: Device-ID als client_reference_id übergeben
      // Dies wird vom Webhook verwendet, um die Lizenz zu aktivieren
      client_reference_id: deviceId,
      metadata: {
        deviceName: deviceName || "Unbenanntes Gerät",
        productType: "software_subscription",
        licenseType: "annual_subscription",
      },
      // Zusätzliche Checkout-Konfiguration für bessere UX
      billing_address_collection: "auto",
      phone_number_collection: {
        enabled: false,
      },
      shipping_address_collection: {
        allowed_countries: ["DE", "AT", "CH", "FR", "NL", "BE", "IT", "ES"],
      },
      custom_text: {
        submit: {
          message: "Ihre Lizenz wird automatisch nach der Zahlung aktiviert.",
        },
        shipping_address: {
          message: "Rechnungsadresse für Ihre Lizenz-Dokumentation",
        },
        terms_of_service_acceptance: {
          message: "Mit dem Kauf stimmen Sie unseren Geschäftsbedingungen zu.",
        },
      },
      consent_collection: {
        terms_of_service: "required",
      },
      // Automatische Steuerberechnung aktivieren
      automatic_tax: {
        enabled: true,
      },
      // Customer-Update-Konfiguration für automatische Steuerberechnung und Tax ID Collection
      // Wird später nur gesetzt wenn wir einen customer haben, nicht bei customer_email
      // Steuerverhalten konfigurieren
      tax_id_collection: {
        enabled: true,
      },
      // Zahlungsmethoden: nur Karte und Link
      payment_method_types: ["card", "link"],
    };

    // **NEU: Prüfe, ob bereits ein Customer mit dieser E-Mail existiert**
    let customerId = null;

    if (email && email.trim() && email.includes("@")) {
      try {
        // Suche nach existierendem Customer mit dieser E-Mail
        const existingCustomers = await stripe.customers.list({
          email: email,
          limit: 1,
        });

        if (existingCustomers.data.length > 0) {
          // Existierenden Customer wiederverwenden
          customerId = existingCustomers.data[0].id;
          console.log(
            `Existierender Customer gefunden und wiederverwendet: ${customerId} für ${email}`
          );
        } else {
          // Neuen Customer erstellen
          const customer = await stripe.customers.create({
            email: email,
            metadata: {
              deviceId: deviceId,
              deviceName: deviceName || "Unbenanntes Gerät",
              created_via: "switchfast_checkout",
            },
          });
          customerId = customer.id;
          console.log(`Neuer Customer erstellt: ${customerId} für ${email}`);
        }
      } catch (error) {
        console.error("Fehler beim Customer-Management:", error);
        // Fallback: Verwende customer_email anstatt customer
        sessionConfig.customer_email = email;
      }
    }

    // Customer oder customer_email setzen
    if (customerId) {
      sessionConfig.customer = customerId;
      // customer_update nur setzen wenn wir einen customer haben
      sessionConfig.customer_update = {
        address: "auto",
        shipping: "auto",
        name: "auto",
      };
    } else if (email && email.trim() && email.includes("@")) {
      sessionConfig.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    // Erfolgreiche Antwort mit der Checkout-URL
    return new Response(
      JSON.stringify({
        success: true,
        url: session.url,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unerwarteter Fehler:", error);
    return new Response(
      JSON.stringify({
        error: "Ein unerwarteter Fehler ist aufgetreten",
        userMessage:
          "Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
