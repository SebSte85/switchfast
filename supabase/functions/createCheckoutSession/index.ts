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
    console.log(`🟢 Verwende Umgebung: ${environment}`);

    // Schema basierend auf der Umgebung auswählen
    const schema = environment === "prod" ? "prod" : "test";
    console.log(`🟢 Verwende Schema: ${schema}`);

    const { deviceId, deviceName, email } = await req.json();
    console.log(`🟢 Request Data:`, {
      deviceId: deviceId || "MISSING",
      deviceName: deviceName || "NOT_PROVIDED",
      email: email || "NOT_PROVIDED",
      hasDeviceId: !!deviceId,
      hasEmail: !!email,
    });

    // Validierung der Eingaben
    if (!deviceId) {
      console.log(`🔴 FEHLER: Device ID fehlt`);
      return new Response(
        JSON.stringify({
          error: "Device ID is required",
          userMessage:
            "A technical error occurred. Please restart the application and try again.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Supabase-Client für Validierung initialisieren
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    console.log(`🟢 Supabase Config:`, {
      hasUrl: !!supabaseUrl,
      urlLength: supabaseUrl?.length || 0,
      hasServiceKey: !!supabaseServiceKey,
      serviceKeyLength: supabaseServiceKey?.length || 0,
      schema: schema,
    });

    const supabaseClient = createClient(
      supabaseUrl ?? "",
      supabaseServiceKey ?? "",
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

    console.log(`🟢 Stripe Config für ${environment}:`, {
      hasSecretKey: !!stripeSecretKey,
      secretKeyLength: stripeSecretKey?.length || 0,
      secretKeyPrefix: stripeSecretKey?.substring(0, 10) || "MISSING",
      hasPriceId: !!priceId,
      priceId: priceId || "MISSING",
      priceIdPrefix: priceId?.substring(0, 10) || "MISSING",
    });

    if (!stripeSecretKey || !priceId) {
      console.log(`🔴 FEHLER: Stripe Konfiguration fehlt`, {
        environment,
        hasSecretKey: !!stripeSecretKey,
        hasPriceId: !!priceId,
      });
      return new Response(
        JSON.stringify({
          error: "Stripe configuration missing",
          userMessage:
            "The payment service is currently unavailable. Please try again later.",
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
          error: "Validation error",
          userMessage: "A technical error occurred. Please try again later.",
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
            userMessage: `This device already has an active license registered${
              license.email ? ` (${license.email})` : ""
            }. Each device can only have one license. If you have issues with your existing license, please contact our support.`,
            existingLicenseEmail: license.email,
            suggestions: [
              "Check if you already purchased a license",
              "Contact our support for license transfer",
              "Use a different device for a new license",
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
    console.log(`🟢 Initialisiere Stripe Client...`);
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });
    console.log(`🟢 Stripe Client erfolgreich initialisiert`);

    // URLs für Erfolg und Abbruch
    const baseSuccessUrl =
      Deno.env.get("STRIPE_SUCCESS_URL") || "https://www.switchfast.io/success";
    const baseCancelUrl =
      Deno.env.get("STRIPE_CANCEL_URL") || "https://www.switchfast.io/cancel";

    console.log(`🟢 URL Config:`, {
      baseSuccessUrl,
      baseCancelUrl,
      environment,
    });

    // Füge Umgebungsparameter zu den URLs hinzu
    const successUrl = `${baseSuccessUrl}${
      baseSuccessUrl.includes("?") ? "&" : "?"
    }env=${environment}`;
    const cancelUrl = `${baseCancelUrl}${
      baseCancelUrl.includes("?") ? "&" : "?"
    }env=${environment}`;

    console.log(`🟢 Final URLs:`, {
      successUrl,
      cancelUrl,
    });

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
        deviceName: deviceName || "Unnamed Device",
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
          message:
            "Your license will be automatically activated after payment.",
        },
        shipping_address: {
          message: "Billing address for your license documentation",
        },
        terms_of_service_acceptance: {
          message: "By purchasing, you agree to our Terms of Service.",
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
      console.log(`🟢 Prüfe Customer für Email: ${email}`);
      try {
        // Suche nach existierendem Customer mit dieser E-Mail
        console.log(`🟢 Suche existierende Customers...`);
        const existingCustomers = await stripe.customers.list({
          email: email,
          limit: 1,
        });
        console.log(`🟢 Customer-Suche Resultat:`, {
          count: existingCustomers.data.length,
          hasResults: existingCustomers.data.length > 0,
        });

        if (existingCustomers.data.length > 0) {
          // Existierenden Customer wiederverwenden
          customerId = existingCustomers.data[0].id;
          console.log(
            `🟢 Existierender Customer gefunden und wiederverwendet: ${customerId} für ${email}`
          );
        } else {
          // Neuen Customer erstellen
          console.log(`🟢 Erstelle neuen Customer für ${email}...`);
          const customer = await stripe.customers.create({
            email: email,
            metadata: {
              deviceId: deviceId,
              deviceName: deviceName || "Unnamed Device",
              created_via: "switchfast_checkout",
            },
          });
          customerId = customer.id;
          console.log(`🟢 Neuer Customer erstellt: ${customerId} für ${email}`);
        }
      } catch (error) {
        console.error("🔴 Fehler beim Customer-Management:", error);
        console.error("🔴 Error Details:", {
          message: error.message,
          stack: error.stack,
          type: error.constructor?.name,
        });
        // Fallback: Verwende customer_email anstatt customer
        sessionConfig.customer_email = email;
        console.log(
          `🟡 Fallback: Verwende customer_email statt customer für ${email}`
        );
      }
    } else {
      console.log(`🟡 Keine gültige Email provided: "${email}"`);
    }

    // Customer oder customer_email setzen
    console.log(`🟢 Setze Customer Config:`, {
      hasCustomerId: !!customerId,
      customerId: customerId || "NOT_SET",
      hasEmail: !!(email && email.trim() && email.includes("@")),
      email: email || "NOT_PROVIDED",
    });

    if (customerId) {
      sessionConfig.customer = customerId;
      // customer_update nur setzen wenn wir einen customer haben
      sessionConfig.customer_update = {
        address: "auto",
        shipping: "auto",
        name: "auto",
      };
      console.log(`🟢 Verwende existierenden/neuen Customer: ${customerId}`);
    } else if (email && email.trim() && email.includes("@")) {
      sessionConfig.customer_email = email;
      console.log(`🟢 Verwende customer_email: ${email}`);
    }

    console.log(`🟢 Finale Session Config:`, {
      mode: sessionConfig.mode,
      hasLineItems: !!sessionConfig.line_items,
      lineItemsCount: sessionConfig.line_items?.length || 0,
      priceId: sessionConfig.line_items?.[0]?.price || "NOT_SET",
      hasSuccessUrl: !!sessionConfig.success_url,
      hasCancelUrl: !!sessionConfig.cancel_url,
      hasCustomer: !!sessionConfig.customer,
      hasCustomerEmail: !!sessionConfig.customer_email,
      clientReferenceId: sessionConfig.client_reference_id,
      automaticTax: sessionConfig.automatic_tax,
      taxIdCollection: sessionConfig.tax_id_collection,
    });

    console.log(`🟢 Erstelle Stripe Checkout Session...`);
    try {
      const session = await stripe.checkout.sessions.create(sessionConfig);
      console.log(`🟢 Stripe Session erfolgreich erstellt:`, {
        sessionId: session.id,
        url: session.url,
        hasUrl: !!session.url,
        urlLength: session.url?.length || 0,
      });

      // Erfolgreiche Antwort mit der Checkout-URL
      return new Response(
        JSON.stringify({
          success: true,
          url: session.url,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (stripeSessionError) {
      console.error(
        "🔴 CRITICAL: Fehler beim Erstellen der Stripe Session:",
        stripeSessionError
      );
      console.error("🔴 Stripe Session Error Details:", {
        message: stripeSessionError.message,
        type: stripeSessionError.type,
        code: stripeSessionError.code,
        param: stripeSessionError.param,
        stack: stripeSessionError.stack,
        requestId: stripeSessionError.requestId,
      });

      // Return detailed error for debugging
      return new Response(
        JSON.stringify({
          error: "Stripe session creation failed",
          userMessage:
            "Unable to create payment session. Please try again later.",
          debugInfo: {
            stripeErrorType: stripeSessionError.type,
            stripeErrorCode: stripeSessionError.code,
            stripeErrorMessage: stripeSessionError.message,
            environment: environment,
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }
  } catch (error) {
    console.error("Unerwarteter Fehler:", error);
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred",
        userMessage: "A technical error occurred. Please try again later.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
