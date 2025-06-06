import React, { useEffect, useState } from 'react';

interface LicenseStatusProps {
  isLicensed: boolean;
  isInTrial: boolean;
  remainingTrialDays: number;
  onPurchaseClick: () => void;
  onActivateClick: () => void;
}

const LicenseStatus: React.FC<LicenseStatusProps> = ({
  isLicensed,
  isInTrial,
  remainingTrialDays,
  onPurchaseClick,
  onActivateClick
}) => {
  return (
    <div className="p-4 bg-gray-800 rounded-lg shadow text-gray-200 border border-gray-700">
      <h2 className="text-lg font-semibold mb-4 text-accent">Lizenzstatus</h2>
      
      {isLicensed ? (
        <div className="flex items-center mb-4">
          <div className="w-3 h-3 bg-accent rounded-full mr-2"></div>
          <span>Lizenziert</span>
        </div>
      ) : isInTrial ? (
        <div>
          <div className="flex items-center mb-2">
            <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
            <span>Trial-Version</span>
          </div>
          <div className="mb-4 text-sm">
            <span className="font-medium">{remainingTrialDays}</span> Tage verbleibend
          </div>
          <div className="mb-4">
            <div className="w-full bg-gray-600 rounded-full h-2">
              <div 
                className="bg-accent h-2 rounded-full" 
                style={{ width: `${Math.min(100, (remainingTrialDays / 7) * 100)}%` }}
              ></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center mb-4">
          <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
          <span>Nicht lizenziert</span>
        </div>
      )}
      
      {!isLicensed && (
        <div className="flex flex-col space-y-2">
          <button
            onClick={onPurchaseClick}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-dark transition-colors"
          >
            Lizenz kaufen
          </button>
          <button
            onClick={onActivateClick}
            className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-700 transition-colors text-gray-200"
          >
            Lizenz aktivieren
          </button>
        </div>
      )}
    </div>
  );
};

export default LicenseStatus;
