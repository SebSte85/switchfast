import React, { useState, useEffect } from 'react';
import { useLicense } from '../../hooks/useLicense';
import DeviceManagement from './DeviceManagement';

interface LicenseInfo {
  licenseKey: string | null;
  email: string | null;
  purchaseDate: string | null;
}

const LicenseSettings: React.FC = () => {
  const { 
    isLicensed, 
    isInTrial, 
    remainingTrialDays,
    checkLicenseStatus,
    deactivateLicense,
    refreshStatus,
    isLoading
  } = useLicense();

  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const [isDeactivating, setIsDeactivating] = useState(false);

  const { ipcRenderer } = window.require('electron');

  // Lizenzinformationen laden
  useEffect(() => {
    const fetchLicenseInfo = async () => {
      try {
        const info = await ipcRenderer.invoke('license:getStatus');
        setLicenseInfo({
          licenseKey: info.licenseKey,
          email: info.email,
          purchaseDate: info.purchaseDate
        });
      } catch (error) {
        console.error('Fehler beim Laden der Lizenzinformationen:', error);
      }
    };

    const fetchCurrentDevice = async () => {
      try {
        const deviceId = await ipcRenderer.invoke('license:getCurrentDevice');
        setCurrentDeviceId(deviceId);
      } catch (error) {
        console.error('Fehler beim Laden der Geräte-ID:', error);
      }
    };

    if (isLicensed) {
      fetchLicenseInfo();
      fetchCurrentDevice();
    }
  }, [isLicensed, ipcRenderer]);

  // Gerät deaktivieren
  const handleDeactivateDevice = async (deviceId: string) => {
    try {
      return await ipcRenderer.invoke('license:deactivateDevice', deviceId);
    } catch (error) {
      console.error('Fehler bei der Gerätedeaktivierung:', error);
      return false;
    }
  };

  // Aktuelle Lizenz deaktivieren
  const handleDeactivateLicense = async () => {
    if (window.confirm('Möchten Sie Ihre Lizenz wirklich auf diesem Gerät deaktivieren?')) {
      setIsDeactivating(true);
      try {
        const success = await deactivateLicense();
        if (success) {
          await refreshStatus();
        }
      } finally {
        setIsDeactivating(false);
      }
    }
  };

  // Lizenzstatus aktualisieren
  const handleRefreshStatus = async () => {
    await checkLicenseStatus();
    await refreshStatus();
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Lizenzeinstellungen</h1>
      
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">Lizenzstatus</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-sm text-gray-600 mb-1">Status</p>
            <p className="font-medium">
              {isLicensed ? (
                <span className="text-green-600">Lizenziert</span>
              ) : isInTrial ? (
                <span className="text-yellow-600">Trial ({remainingTrialDays} Tage verbleibend)</span>
              ) : (
                <span className="text-red-600">Nicht lizenziert</span>
              )}
            </p>
          </div>
          
          {isLicensed && licenseInfo && (
            <>
              <div>
                <p className="text-sm text-gray-600 mb-1">Lizenzschlüssel</p>
                <p className="font-medium">{licenseInfo.licenseKey?.substring(0, 8)}...</p>
              </div>
              
              {licenseInfo.email && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">E-Mail</p>
                  <p className="font-medium">{licenseInfo.email}</p>
                </div>
              )}
              
              {licenseInfo.purchaseDate && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Kaufdatum</p>
                  <p className="font-medium">
                    {new Date(licenseInfo.purchaseDate).toLocaleDateString()}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        
        <div className="flex space-x-2">
          <button
            onClick={handleRefreshStatus}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
          >
            Status aktualisieren
          </button>
          
          {isLicensed && (
            <button
              onClick={handleDeactivateLicense}
              disabled={isDeactivating}
              className="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {isDeactivating ? 'Wird deaktiviert...' : 'Lizenz auf diesem Gerät deaktivieren'}
            </button>
          )}
        </div>
      </div>
      
      {isLicensed && (
        <DeviceManagement 
          onDeactivateDevice={handleDeactivateDevice}
          currentDeviceId={currentDeviceId}
        />
      )}
    </div>
  );
};

export default LicenseSettings;
