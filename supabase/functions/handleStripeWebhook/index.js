// Diese Datei konfiguriert die Supabase Edge Function, um anonyme Anfragen zu erlauben
export const config = {
  path: "*",
  // Deaktiviert die JWT-Authentifizierung für diese Funktion
  // Stripe-Webhooks werden durch die Signatur authentifiziert, nicht durch JWT
  auth: {
    required: false,
  },
  // Wichtig: Erlaubt Anfragen ohne API-Key
  // Dies ist notwendig für Stripe-Webhooks
  ignoreAPIKey: true,
};
