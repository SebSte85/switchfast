import React, { useState, useEffect } from 'react';

interface Device {
  id: string;
  name: string;
  firstActivated: string;
  lastCheckIn: string;
  isCurrentDevice: boolean;
}

interface DeviceManagementProps {
  onDeactivateDevice: (deviceId: string) => Promise<boolean>;
  currentDeviceId: string;
}

const DeviceManagement: React.FC<DeviceManagementProps> = ({ 
  onDeactivateDevice,
  currentDeviceId
}) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const { ipcRenderer } = window.require('electron');

  // Geräte laden
  const loadDevices = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const deviceList = await ipcRenderer.invoke('license:getDevices');
      setDevices(deviceList.map((device: any) => ({
        ...device,
        isCurrentDevice: device.id === currentDeviceId
      })));
    } catch (err) {
      console.error('Fehler beim Laden der Geräte:', err);
      setError('Die Geräteliste konnte nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  };

  // Gerät deaktivieren
  const handleDeactivate = async (deviceId: string) => {
    if (window.confirm('Möchten Sie dieses Gerät wirklich deaktivieren?')) {
      setDeactivatingId(deviceId);
      
      try {
        const success = await onDeactivateDevice(deviceId);
        
        if (success) {
          await loadDevices();
        } else {
          setError('Das Gerät konnte nicht deaktiviert werden.');
        }
      } catch (err) {
        console.error('Fehler bei der Deaktivierung:', err);
        setError('Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.');
      } finally {
        setDeactivatingId(null);
      }
    }
  };

  // Geräte beim ersten Laden abrufen
  useEffect(() => {
    loadDevices();
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-4">Aktivierte Geräte</h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}
      
      {devices.length === 0 ? (
        <p className="text-gray-500">Keine Geräte aktiviert.</p>
      ) : (
        <div className="space-y-4">
          {devices.map((device) => (
            <div 
              key={device.id} 
              className={`p-3 border rounded ${device.isCurrentDevice ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">
                    {device.name}
                    {device.isCurrentDevice && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                        Dieses Gerät
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    Aktiviert: {new Date(device.firstActivated).toLocaleDateString()}
                  </div>
                  <div className="text-sm text-gray-500">
                    Letzter Check: {new Date(device.lastCheckIn).toLocaleDateString()}
                  </div>
                </div>
                
                <button
                  onClick={() => handleDeactivate(device.id)}
                  disabled={deactivatingId === device.id}
                  className="px-3 py-1 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  {deactivatingId === device.id ? 'Wird deaktiviert...' : 'Deaktivieren'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      
      <div className="mt-4 text-sm text-gray-500">
        <p>Sie können Ihre Lizenz auf bis zu 3 Geräten aktivieren.</p>
      </div>
    </div>
  );
};

export default DeviceManagement;
