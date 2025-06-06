import React, { useState } from "react";
import { useLicense } from "../../hooks/useLicense";

const LicensePage: React.FC = () => {
  const { openStripeCheckout, isLoading } = useLicense();
  const [email, setEmail] = useState("");

  const { ipcRenderer } = window.require("electron");

  const handlePurchaseClick = async () => {
    await openStripeCheckout(email);
  };

  const handleCloseApp = () => {
    ipcRenderer.invoke("app:quit");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#414159] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#2D2D3F] rounded-lg shadow-xl p-8 border border-gray-700">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">switchfast</h1>
          <p className="text-gray-400">Trial Period Expired</p>
        </div>

        {/* Content */}
        <div className="text-center mb-8">
          <p className="text-gray-300 leading-relaxed mb-6">
            Your free trial has ended. To continue using switchfast, please
            purchase a license.
          </p>
          <p className="text-sm text-gray-400 mb-4">
            Thank you for trying switchfast! We hope you enjoyed the experience.
          </p>
        </div>

        {/* Purchase Button */}
        <button
          onClick={handlePurchaseClick}
          className="w-full bg-accent hover:bg-accent-dark text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
        >
          Purchase License
        </button>

        {/* Restart Notice */}
        <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
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

        {/* Footer Actions */}
        <div className="mt-8 pt-6 border-t border-gray-600">
          <button
            onClick={handleCloseApp}
            className="w-full text-gray-400 hover:text-gray-300 text-sm py-2 transition-colors"
          >
            Close Application
          </button>
        </div>
      </div>
    </div>
  );
};

export default LicensePage;
