import React, { useState } from 'react';
import { useLicense } from '../../hooks/useLicense';

interface LicenseStatusBarProps {
  onSettingsClick?: () => void;
}

const LicenseStatusBar: React.FC<LicenseStatusBarProps> = ({ onSettingsClick }) => {
  const { isLicensed, isInTrial, remainingTrialDays, isLoading } = useLicense();
  const [isHovered, setIsHovered] = useState(false);

  if (isLoading) {
    return (
      <div className="px-3 py-1 text-xs text-gray-500">
        Lizenz wird geprüft...
      </div>
    );
  }

  return (
    <div 
      className="relative cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSettingsClick}
    >
      <div className="px-3 py-1 flex items-center space-x-1">
        {isLicensed ? (
          <>
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-xs text-gray-700">Lizenziert</span>
          </>
        ) : isInTrial ? (
          <>
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
            <span className="text-xs text-gray-700">Trial ({remainingTrialDays}d)</span>
          </>
        ) : (
          <>
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <span className="text-xs text-gray-700">Nicht lizenziert</span>
          </>
        )}
      </div>

      {isHovered && (
        <div className="absolute bottom-full mb-2 right-0 bg-white shadow-lg rounded p-3 w-64 z-10">
          <div className="text-sm font-medium mb-2">
            {isLicensed ? (
              "SwitchFast ist lizenziert"
            ) : isInTrial ? (
              `Trial-Version: ${remainingTrialDays} Tage verbleibend`
            ) : (
              "Keine gültige Lizenz"
            )}
          </div>
          
          {isInTrial && (
            <div className="mb-2">
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div 
                  className="bg-yellow-500 h-1.5 rounded-full" 
                  style={{ width: `${Math.min(100, (remainingTrialDays / 7) * 100)}%` }}
                ></div>
              </div>
            </div>
          )}
          
          <div className="text-xs text-gray-500">
            {isLicensed ? (
              "Vielen Dank für Ihren Kauf!"
            ) : isInTrial ? (
              "Kaufen Sie eine Lizenz, um SwitchFast dauerhaft zu nutzen."
            ) : (
              "Bitte kaufen oder aktivieren Sie eine Lizenz, um SwitchFast zu nutzen."
            )}
          </div>
          
          <div className="text-xs text-blue-600 mt-1">
            Klicken für Lizenzeinstellungen
          </div>
        </div>
      )}
    </div>
  );
};

export default LicenseStatusBar;
