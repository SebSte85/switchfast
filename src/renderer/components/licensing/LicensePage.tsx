import React, { useState, useEffect } from "react";
import { useLicense } from "../../hooks/useLicense";
import "../PrivacyConsentModal.css"; // Für die grüne Scrollbar

interface UsageStats {
  themeCreated: number;
  shortcutUsed: number;
  totalEvents: number;
}

const LicensePage: React.FC = () => {
  const { openStripeCheckout, isLoading } = useLicense();
  const [email, setEmail] = useState("");
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const { ipcRenderer } = window.require("electron");

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
    ipcRenderer.invoke("app:quit");
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
