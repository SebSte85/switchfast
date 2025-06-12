import React, { useEffect, useState } from "react";
import { ipcRenderer } from "electron";
import { useLicense } from "../../hooks/useLicense";
import { trackUIEvent } from "../../analytics";

interface UsageStats {
  themeCreated: number;
  shortcutUsed: number;
  totalEvents: number;
}

const LicensePage: React.FC = () => {
  const { openStripeCheckout, isLoading, deleteAccount } = useLicense();
  const [email, setEmail] = useState("");
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Fetch usage statistics from PostHog
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const stats = await ipcRenderer.invoke("analytics:getUsageStats");
        setUsageStats(stats);
      } catch (error) {
        console.error("Error fetching usage stats:", error);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
  }, []);

  const handlePurchaseClick = async () => {
    await openStripeCheckout(email);
  };

  const handleCloseApp = () => {
    // Track PostHog Event beim Close Button-Klick für Survey
    trackUIEvent("trial_expired_close_clicked", {
      themes_created: usageStats?.themeCreated || 0,
      shortcuts_used: usageStats?.shortcutUsed || 0,
      total_interactions: usageStats?.totalEvents || 0,
      action_source: "trial_expired_dialog",
    });

    // Verzögerung damit Survey angezeigt und ausgefüllt werden kann
    // User hat Zeit die Survey zu sehen und zu beantworten
    setTimeout(() => {
      ipcRenderer.invoke("app:quit");
    }, 8000); // 8 Sekunden - genug Zeit für Survey
  };

  const handleDeleteAccount = async () => {
    console.log("🟡 [DEBUG] handleDeleteAccount clicked");
    setShowDeleteModal(true);
  };

  const confirmDeleteAccount = async () => {
    console.log("🟡 [DEBUG] confirmDeleteAccount started");
    setIsDeleting(true);
    setShowDeleteModal(false);
    setActionMessage(null);

    try {
      // 1. Account-Daten in Supabase/Stripe löschen
      console.log("🟡 [DEBUG] Calling deleteAccount...");
      const result = await deleteAccount();
      console.log("🟡 [DEBUG] deleteAccount result:", result);

      if (result) {
        console.log(
          "🟢 [DEBUG] Account deletion successful, starting cleanup..."
        );
        setActionMessage(
          "Account successfully deleted. All data has been permanently removed."
        );

        // 2. Lokale Device-Daten löschen (für Fresh Start)
        console.log("🗑️ Clearing local device data for fresh start...");
        await ipcRenderer.invoke("device:clear-local-data");

        // 3. Success-Message 5 Sekunden anzeigen
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
        console.log("🔴 [DEBUG] Account deletion failed");
        setActionMessage("Failed to delete account. Please try again.");
      }
    } catch (error) {
      console.error("🔴 [DEBUG] Error deleting account:", error);
      setActionMessage(
        "An error occurred while deleting your account. Please try again."
      );
    } finally {
      console.log("🟡 [DEBUG] confirmDeleteAccount finished");
      setIsDeleting(false);
    }
  };

  const cancelDeleteAccount = () => {
    setShowDeleteModal(false);
  };

  const handleWebsiteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const { shell } = window.require("electron");
    shell.openExternal("https://www.switchfast.io");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2D2D3F] flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-[#2D2D3F] rounded-lg shadow-xl border border-gray-700 max-h-[90vh] flex flex-col">
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
                    Are you sure you want to permanently delete your account?
                    This action cannot be undone.
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
                          <li>
                            You will lose access to SwitchFast immediately
                          </li>
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

        {/* Header with Logo */}
        <div className="flex justify-between items-center p-6 pb-4 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-center">
            <div className="w-12 h-12 flex items-center justify-center mr-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="w-10 h-10"
              >
                <rect
                  width="20"
                  height="12"
                  x="2"
                  y="6"
                  fill="#78d97c"
                  rx="6"
                  ry="6"
                ></rect>
                <path
                  fill="#2d2d3f"
                  d="M15.58,14.33c-.2,0-.39-.08-.53-.22l-1.58-1.58c-.29-.29-.29-.77,0-1.06s.77-.29,1.06,0l.98,.98,1.9-2.5c.25-.33,.72-.4,1.05-.14,.33,.25,.39,.72,.14,1.05l-2.42,3.18c-.13,.17-.33,.28-.55,.29-.02,0-.03,0-.05,0Z"
                ></path>
                <circle cx="8" cy="12" r="3" fill="#2d2d3f"></circle>
              </svg>
            </div>
            <h1 className="text-xl font-bold text-[#78d97c]">switchfast</h1>
          </div>
          <p className="text-white text-xl font-bold">Trial Period Expired</p>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {/* Founder Section */}
          <div className="flex items-center mb-6 p-4 bg-gray-800/50 rounded-lg border border-gray-600">
            <img
              src={require("../../../assets/founder.jpg")}
              alt="Sebastian, Creator of switchfast"
              className="w-20 h-20 rounded-full object-cover mr-4 border-2 border-[#78d97c]"
            />
            <div className="flex-1">
              <p className="text-gray-300 text-sm leading-relaxed">
                Hi, I'm Sebastian, the creator of switchfast. Take a look below
                at your usage statistics during your trial.
              </p>
              <p className="text-gray-300 text-sm leading-relaxed">
                If you feel like switchfast is worth it for you, please consider
                subscribing to a yearly license for only €5.
              </p>
            </div>
          </div>

          {/* Usage Statistics */}
          {!statsLoading && usageStats && (
            <div className="mb-6 p-4 bg-gray-800/30 rounded-lg border border-gray-600">
              <h3 className="text-lg font-semibold text-[#78d97c] mb-3">
                Your Trial Activity
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300 text-sm">Themes created</span>
                  <span className="text-[#78d97c] font-semibold text-lg">
                    {usageStats.themeCreated}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-300 text-sm">Shortcuts used</span>
                  <span className="text-[#78d97c] font-semibold text-lg">
                    {usageStats.shortcutUsed}
                  </span>
                </div>
                <div className="border-t border-gray-600 pt-3 mt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 font-medium">
                      Total interactions
                    </span>
                    <span className="text-[#78d97c] font-bold text-xl">
                      {usageStats.totalEvents}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-gray-400 text-xs mt-3 text-center">
                These stats show you've been actively using switchfast's key
                features!
              </p>
            </div>
          )}

          {/* Restart Notice */}
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <div className="flex items-start">
              <svg
                className="w-5 h-5 text-amber-400 mt-0.5 mr-3 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <div>
                <p className="text-sm text-amber-300 font-medium">
                  Important Notice
                </p>
                <p className="text-xs text-amber-200 mt-1">
                  After completing your purchase, please restart the application
                  to activate your license.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Message - Fixed Position outside scrollable area */}
        {actionMessage && (
          <div
            className={`p-4 mx-6 mb-4 border rounded-lg flex-shrink-0 ${
              actionMessage.includes("successfully") ||
              actionMessage.includes("🎉")
                ? "bg-green-500/10 border-green-500/30"
                : "bg-red-500/10 border-red-500/30"
            }`}
          >
            <div className="flex items-start">
              <svg
                className={`w-5 h-5 mt-0.5 mr-3 flex-shrink-0 ${
                  actionMessage.includes("successfully") ||
                  actionMessage.includes("🎉")
                    ? "text-green-400"
                    : "text-red-400"
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={
                    actionMessage.includes("successfully") ||
                    actionMessage.includes("🎉")
                      ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      : "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                  }
                />
              </svg>
              <div>
                <p
                  className={`text-sm font-medium ${
                    actionMessage.includes("successfully") ||
                    actionMessage.includes("🎉")
                      ? "text-green-300"
                      : "text-red-300"
                  }`}
                >
                  Status Update
                </p>
                <p
                  className={`text-xs mt-1 ${
                    actionMessage.includes("successfully") ||
                    actionMessage.includes("🎉")
                      ? "text-green-200"
                      : "text-red-200"
                  }`}
                >
                  {actionMessage}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons & Footer */}
        <div className="p-6 pt-4 border-t border-gray-700 flex-shrink-0">
          <div className="flex gap-3 mb-4">
            <button
              onClick={handlePurchaseClick}
              className="flex-1 bg-[#78d97c] hover:bg-[#6bc870] text-white font-semibold py-3 px-6 rounded-lg transition-colors focus:outline-none focus:ring-0 transform hover:scale-[1.02] transition-transform"
              style={{ boxShadow: "0 4px 8px rgba(120, 217, 124, 0.3)" }}
            >
              Buy Subscription
            </button>
            <button
              onClick={handleCloseApp}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold py-3 px-6 rounded-lg transition-colors focus:outline-none focus:ring-0 border border-gray-500"
            >
              Close
            </button>
          </div>

          {/* Delete Account Option */}
          <div className="flex justify-center mb-4">
            <button
              onClick={handleDeleteAccount}
              disabled={isDeleting}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-red-400 text-sm rounded-lg transition-colors border border-gray-600 hover:border-red-500/50 disabled:opacity-50"
            >
              {isDeleting ? (
                <div className="flex items-center gap-2">
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
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Delete Account
                </div>
              )}
            </button>
          </div>

          {/* Company Information */}
          <div className="pt-3 border-t border-gray-700">
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              DigITup GmbH - Königsallee 27 - 40212 Düsseldorf - Germany
            </p>
            <a
              href="https://www.switchfast.io"
              onClick={handleWebsiteClick}
              className="text-xs text-gray-500 text-center leading-relaxed block mt-1 cursor-pointer hover:text-gray-400 transition-colors focus:outline-none"
            >
              www.switchfast.io
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LicensePage;
