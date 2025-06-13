import React, { useState, useEffect } from "react";
import { ipcRenderer } from "electron";
import { useLicense } from "../hooks/useLicense";
import { trackUIEvent } from "../analytics"; // PostHog Event Tracking
import posthog from "posthog-js"; // PostHog direkt importieren

// PostHog Type Declaration für Window (nicht mehr benötigt, aber lassen wir drin)
declare global {
  interface Window {
    posthog?: {
      on: (event: string, callback: () => void) => void;
      off: (event: string, callback: () => void) => void;
    };
  }
}

interface SettingsProps {
  onClose: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");
  const [isClosing, setIsClosing] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [isSendingContact, setIsSendingContact] = useState(false);
  const {
    subscriptionEndDate,
    isSubscription,
    cancelSubscription,
    deleteAccount,
    cancelledAt,
    cancelsAtPeriodEnd,
    checkLicenseStatus,
    openStripeCheckout,
    email: userEmail,
  } = useLicense();

  // Debug: Log subscription data whenever it changes
  useEffect(() => {
    console.log("🔍 [Settings DEBUG] Subscription Data:", {
      subscriptionEndDate,
      isSubscription,
      cancelledAt,
      cancelsAtPeriodEnd,
    });
  }, [subscriptionEndDate, isSubscription, cancelledAt, cancelsAtPeriodEnd]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // Check autostart status
        const isEnabled = await ipcRenderer.invoke("autostart:is-enabled");
        setAutoStartEnabled(isEnabled);

        // Get device ID
        const id = await ipcRenderer.invoke("get-device-id");
        setDeviceId(id);

        // Always refresh license status from database when Settings open
        console.log("🔄 Settings: Refreshing license status from database...");
        const licenseValid = await checkLicenseStatus();
        console.log(
          "✅ Settings: License status refreshed, valid:",
          licenseValid
        );

        // Enable autostart by default if not already configured
        if (!isEnabled) {
          try {
            const success = await ipcRenderer.invoke("autostart:enable");
            if (success) {
              setAutoStartEnabled(true);
            }
          } catch (error) {
            console.error("Error enabling autostart by default:", error);
          }
        }
      } catch (error) {
        console.error("Error loading initial data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, [checkLicenseStatus]);

  const handleCancelSubscription = async () => {
    console.log("🔴 [DEBUG] Cancel Subscription Button geklickt");

    // Track PostHog Event beim Button-Klick für Survey
    trackUIEvent("cancel_subscription_clicked", {
      subscription_end_date: subscriptionEndDate,
      is_subscription: isSubscription,
      has_cancelled_before: !!cancelledAt,
      action_source: "settings_page",
    });
    console.log(
      "🔴 [DEBUG] PostHog Event 'cancel_subscription_clicked' gesendet"
    );

    // Survey Event Listener über window events
    let surveyHandled = false;

    console.log("🟡 [DEBUG] Setze Survey Event Listeners");

    const handleSurveyComplete = () => {
      console.log("🟢 [DEBUG] Survey completed Event empfangen");
      if (!surveyHandled) {
        surveyHandled = true;
        startCancellationProcess();
        // Cleanup
        window.removeEventListener("survey_completed", handleSurveyComplete);
      }
    };

    const startCancellationProcess = () => {
      console.log("🔵 [DEBUG] Starte Kündigungsprozess direkt (ohne Popup)");
      cancelSubscription().then((result) => {
        if (result) {
          console.log("🟢 [DEBUG] Kündigung erfolgreich");
          setActionMessage(
            "Subscription cancelled successfully. You will retain access until the end of your billing period."
          );
        } else {
          console.log("🔴 [DEBUG] Kündigung fehlgeschlagen");
          setActionMessage("Failed to cancel subscription. Please try again.");
        }
      });
    };

    // Event Listener für Survey-Ende hinzufügen
    window.addEventListener("survey_completed", handleSurveyComplete);

    // Fallback nach 8 Sekunden - auch hier direkt kündigen
    setTimeout(() => {
      console.log("🟠 [DEBUG] 8 Sekunden Fallback erreicht");
      if (!surveyHandled) {
        surveyHandled = true;
        console.log(
          "🟠 [DEBUG] Survey nicht behandelt - starte Kündigung (Fallback)"
        );
        startCancellationProcess();
        window.removeEventListener("survey_completed", handleSurveyComplete);
      }
    }, 8000);
  };

  const handleDeleteAccount = async () => {
    setShowDeleteModal(true);
  };

  const confirmDeleteAccount = async () => {
    setIsDeleting(true);
    setShowDeleteModal(false);

    try {
      // 1. Account-Daten in Supabase/Stripe löschen
      const result = await deleteAccount();
      if (result) {
        setActionMessage(
          "Account successfully deleted. All data has been permanently removed."
        );

        // 2. Lokale Device-Daten löschen (für Fresh Start)
        console.log("🗑️ Clearing local device data for fresh start...");
        await ipcRenderer.invoke("device:clear-local-data");

        // 3. Success-Message 5 Sekunden anzeigen (wie gewünscht)
        let countdown = 5;
        setActionMessage(
          `Account successfully deleted. Application will close in ${countdown} seconds...`
        );

        const countdownInterval = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            setActionMessage(
              `Account successfully deleted. Application will close in ${countdown} seconds...`
            );
          } else {
            clearInterval(countdownInterval);
            setActionMessage("Closing application...");
            // App schließen
            ipcRenderer.invoke("app:quit");
          }
        }, 1000);
      } else {
        setActionMessage("Failed to delete account. Please try again.");
      }
    } catch (error) {
      console.error("Error deleting account:", error);
      setActionMessage(
        "An error occurred while deleting your account. Please try again."
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelDeleteAccount = () => {
    setShowDeleteModal(false);
  };

  const handleContactClick = () => {
    setShowContactModal(true);
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactMessage.trim()) return;

    setIsSendingContact(true);

    try {
      // Use userEmail if available, otherwise use contactEmail from form
      const emailToUse = userEmail || contactEmail;

      console.log("Contact form submitted:", {
        email: emailToUse,
        message: contactMessage,
      });

      // Call the IPC handler to send the contact message
      const result = await ipcRenderer.invoke("contact:sendMessage", {
        email: emailToUse,
        message: contactMessage,
      });

      if (result.success) {
        console.log("✅ Contact message sent successfully");
        // Close modal and reset form
        setShowContactModal(false);
        setContactEmail("");
        setContactMessage("");
        // Optional: Show success message to user
        // You could add a toast notification here
      } else {
        console.error("❌ Failed to send contact message:", result.error);
        // Optional: Show error message to user
        // You could add an error state here
      }
    } catch (error) {
      console.error("❌ Error sending contact message:", error);
      // Optional: Show error message to user
    } finally {
      setIsSendingContact(false);
    }
  };

  const cancelContact = () => {
    setShowContactModal(false);
    setContactEmail("");
    setContactMessage("");
  };

  const handleReactivateSubscription = async () => {
    setIsReactivating(true);
    setActionMessage(null);

    try {
      const result = await ipcRenderer.invoke("license:reactivateSubscription");

      if (result.success) {
        setActionMessage(
          "Subscription successfully reactivated! Welcome back! 🎉"
        );
        // Refresh license status to update UI
        await checkLicenseStatus();
      } else {
        setActionMessage(
          result.message ||
            "Failed to reactivate subscription. Please try again."
        );
      }
    } catch (error) {
      console.error("Error reactivating subscription:", error);
      setActionMessage(
        "Network error. Please check your connection and try again."
      );
    } finally {
      setIsReactivating(false);
    }
  };

  // Toggle autostart setting
  const handleAutoStartToggle = async () => {
    setIsSaving(true);
    try {
      let success = false;

      if (autoStartEnabled) {
        success = await ipcRenderer.invoke("autostart:disable");
      } else {
        success = await ipcRenderer.invoke("autostart:enable");
      }

      if (success) {
        setAutoStartEnabled(!autoStartEnabled);
      } else {
        console.error("Error changing autostart setting");
      }
    } catch (error) {
      console.error("Error changing autostart setting:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle close with animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300); // Match animation duration
  };

  return (
    <div
      className={`settings-container ${
        isClosing ? "settings-slide-out" : "settings-slide-in"
      }`}
    >
      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-[#2a2a3e] border border-red-500/30 rounded-lg p-6 max-w-md mx-4 shadow-2xl">
            <div className="flex items-start mb-4">
              <svg
                className="w-6 h-6 text-red-500 mr-3 mt-0.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  Delete Account
                </h3>
                <p className="text-gray-300 text-sm mb-4">
                  Are you sure you want to permanently delete your account? This
                  action cannot be undone.
                </p>
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 mb-4">
                  <div className="flex items-start">
                    <svg
                      className="w-4 h-4 text-red-400 mr-2 mt-0.5 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="text-xs text-red-300">
                      <p className="font-medium mb-1">What will happen:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>Your account will be permanently deleted</li>
                        <li>
                          All personal data will be removed from our servers
                        </li>
                        <li>
                          Your subscription will be automatically cancelled if
                          active
                        </li>
                        <li>You will lose access to SwitchFast immediately</li>
                        <li>This action cannot be reversed</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelDeleteAccount}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteAccount}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <svg
                      className="animate-spin w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Deleting...
                  </>
                ) : (
                  "Delete Account"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact Modal */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-[#2a2a3e] border border-[#78d97c]/30 rounded-lg p-6 max-w-md mx-4 shadow-2xl">
            <div className="flex items-start mb-4">
              <svg
                className="w-6 h-6 text-[#78d97c] mr-3 mt-0.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Contact Support
                </h3>
                <p className="text-gray-300 text-sm mb-4">
                  Send us a message and we'll get back to you as soon as
                  possible.
                </p>

                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div>
                    <label className="block text-white/80 text-sm mb-1">
                      Your email address
                    </label>
                    {userEmail ? (
                      // User has email in database - show read-only
                      <>
                        <div className="w-full px-3 py-2 rounded-md bg-[#1a1a24] border border-gray-700 text-white/80 text-sm">
                          {userEmail}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          We'll use this email to respond to your message
                        </p>
                      </>
                    ) : (
                      // Trial user without email - show editable field
                      <>
                        <input
                          type="email"
                          className="w-full px-3 py-2 rounded-md bg-[#232336] border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-[#78d97c] focus:border-transparent transition-colors"
                          placeholder="e.g. john.doe@email.com"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          required
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          Please provide your email so we can respond to you
                        </p>
                      </>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="contact-message"
                      className="block text-white/80 text-sm mb-1"
                    >
                      Your message *
                    </label>
                    <textarea
                      id="contact-message"
                      className="w-full px-3 py-2 rounded-md bg-[#232336] border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-[#78d97c] focus:border-transparent transition-colors resize-none"
                      placeholder="How can we help you?"
                      rows={4}
                      required
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                    />
                  </div>

                  <div className="flex gap-3 justify-end pt-2">
                    <button
                      type="button"
                      onClick={cancelContact}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={
                        isSendingContact ||
                        !contactMessage.trim() ||
                        (!userEmail && !contactEmail.trim())
                      }
                      className="px-4 py-2 bg-[#78d97c] text-white rounded-lg hover:bg-[#6bc870] transition-colors text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSendingContact ? (
                        <>
                          <svg
                            className="animate-spin w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                          Sending...
                        </>
                      ) : (
                        "Send Message"
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="settings-header">
        <div className="settings-title">
          <svg
            className="w-6 h-6 text-[#78d97c] mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <h2 className="text-[#78d97c]">Settings</h2>
        </div>
        <button
          className="settings-close-button"
          onClick={handleClose}
          title="Close Settings"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="settings-content">
        <div className="settings-section">
          <h3 className="settings-section-title">Startup</h3>
          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Start with Windows</div>
              <div className="settings-item-description">
                SwitchFast will automatically start when Windows boots up. Your
                app groups will be available immediately.
              </div>
            </div>
            <div className="settings-item-control">
              {isLoading ? (
                <div className="settings-loading">
                  <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                </div>
              ) : (
                <button
                  className={`toggle-switch ${
                    autoStartEnabled ? "enabled" : "disabled"
                  } ${isSaving ? "saving" : ""}`}
                  onClick={handleAutoStartToggle}
                  disabled={isSaving}
                >
                  <div className="toggle-slider">
                    {isSaving && (
                      <svg
                        className="toggle-spinner animate-spin w-3 h-3"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Device Information */}
        <div className="settings-section">
          <h3 className="settings-section-title">Device</h3>
          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Device ID</div>
              <div className="settings-item-description">
                {deviceId || "Loading..."}
              </div>
            </div>
          </div>
        </div>

        {/* About Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">About</h3>
          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Subscription</div>
              <div className="settings-item-description">
                {isSubscription && subscriptionEndDate ? (
                  <>
                    <div>
                      Subscription valid until:{" "}
                      {new Date(subscriptionEndDate).toLocaleDateString()}
                    </div>
                    {(cancelsAtPeriodEnd || cancelledAt) && (
                      <div className="text-amber-400 text-sm mt-2">
                        ⚠️ Subscription cancelled on{" "}
                        {cancelledAt
                          ? new Date(cancelledAt).toLocaleDateString()
                          : "unknown date"}{" "}
                        - Access until end of billing period
                      </div>
                    )}
                  </>
                ) : cancelledAt || cancelsAtPeriodEnd ? (
                  <>
                    <div className="text-red-400">Subscription cancelled</div>
                    <div className="text-amber-400 text-sm mt-2">
                      ⚠️ Cancelled on{" "}
                      {cancelledAt
                        ? new Date(cancelledAt).toLocaleDateString()
                        : "unknown date"}
                      {subscriptionEndDate && (
                        <>
                          {" "}
                          - Was valid until{" "}
                          {new Date(subscriptionEndDate).toLocaleDateString()}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  "No active subscription"
                )}
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
                {isSubscription && !cancelsAtPeriodEnd && !cancelledAt && (
                  <button
                    className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    onClick={handleCancelSubscription}
                  >
                    Cancel Subscription
                  </button>
                )}
                {(cancelsAtPeriodEnd || cancelledAt) && (
                  <button
                    className={`px-3 py-2 bg-[#78d97c] text-white rounded-lg hover:bg-[#6bc870] transition-colors text-sm font-medium flex items-center gap-2 ${
                      isReactivating ? "opacity-75 cursor-not-allowed" : ""
                    }`}
                    onClick={handleReactivateSubscription}
                    disabled={isReactivating}
                  >
                    {isReactivating ? (
                      <>
                        <svg
                          className="animate-spin w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Reactivating...
                      </>
                    ) : (
                      "Renew Subscription"
                    )}
                  </button>
                )}
                <button
                  className="px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors"
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete Account"}
                </button>
              </div>
              {actionMessage && (
                <div
                  className={`mt-4 p-3 border rounded-lg ${
                    actionMessage.includes("successfully") ||
                    actionMessage.includes("🎉")
                      ? "bg-green-500/10 border-green-500/30"
                      : "bg-amber-500/10 border-amber-500/30"
                  }`}
                >
                  <div className="flex items-start">
                    <svg
                      className={`w-5 h-5 mt-0.5 mr-3 flex-shrink-0 ${
                        actionMessage.includes("successfully") ||
                        actionMessage.includes("🎉")
                          ? "text-green-400"
                          : "text-amber-400"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div>
                      <p
                        className={`text-sm font-medium ${
                          actionMessage.includes("successfully") ||
                          actionMessage.includes("🎉")
                            ? "text-green-300"
                            : "text-amber-300"
                        }`}
                      >
                        Status Update
                      </p>
                      <p
                        className={`text-xs mt-1 ${
                          actionMessage.includes("successfully") ||
                          actionMessage.includes("🎉")
                            ? "text-green-200"
                            : "text-amber-200"
                        }`}
                      >
                        {actionMessage}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Kontakt & Support Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">Contact & Support</h3>
          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Get in touch</div>
              <div className="settings-item-description">
                Have questions, feedback, or need help? Send us a message.
              </div>
            </div>
            <div className="settings-item-control">
              <button
                onClick={handleContactClick}
                className="px-4 py-2 bg-[#78d97c] text-white rounded-lg hover:bg-[#6bc870] transition-colors font-semibold"
              >
                Contact
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
