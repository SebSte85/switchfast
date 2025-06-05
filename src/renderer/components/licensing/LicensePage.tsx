import React, { useState } from 'react';
import LicenseStatus from './LicenseStatus';
import LicenseActivation from './LicenseActivation';
import { useLicense } from '../../hooks/useLicense';

const LicensePage: React.FC = () => {
  const {
    isLicensed,
    isInTrial,
    remainingTrialDays,
    isLoading,
    activateLicense,
    openStripeCheckout,
    refreshStatus
  } = useLicense();

  const [showActivation, setShowActivation] = useState(false);
  const [email, setEmail] = useState('');

  const handlePurchaseClick = async () => {
    await openStripeCheckout(email);
  };

  const handleActivateClick = () => {
    setShowActivation(true);
  };

  const handleActivate = async (licenseKey: string) => {
    const success = await activateLicense(licenseKey);
    if (success) {
      setShowActivation(false);
      await refreshStatus();
    }
    return success;
  };

  const handleCancel = () => {
    setShowActivation(false);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">SwitchFast Lizenz</h1>

      {showActivation ? (
        <LicenseActivation
          onActivate={handleActivate}
          onCancel={handleCancel}
        />
      ) : (
        <>
          <LicenseStatus
            isLicensed={isLicensed}
            isInTrial={isInTrial}
            remainingTrialDays={remainingTrialDays}
            onPurchaseClick={handlePurchaseClick}
            onActivateClick={handleActivateClick}
          />

          {!isLicensed && (
            <div className="mt-6 p-4 bg-white rounded-lg shadow">
              <h2 className="text-lg font-semibold mb-4">Lizenz kaufen</h2>
              <p className="mb-4 text-sm text-gray-600">
                Geben Sie optional Ihre E-Mail-Adresse ein, um den Checkout-Prozess zu beschleunigen.
              </p>
              <div className="mb-4">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="E-Mail-Adresse (optional)"
                />
              </div>
              <button
                onClick={handlePurchaseClick}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Jetzt kaufen
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default LicensePage;
