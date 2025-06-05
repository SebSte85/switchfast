import React, { useState } from 'react';

interface LicenseActivationProps {
  onActivate: (licenseKey: string) => Promise<boolean>;
  onCancel: () => void;
}

const LicenseActivation: React.FC<LicenseActivationProps> = ({
  onActivate,
  onCancel
}) => {
  const [licenseKey, setLicenseKey] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!licenseKey.trim()) {
      setError('Bitte geben Sie einen Lizenzschlüssel ein');
      return;
    }

    setError(null);
    setIsActivating(true);
    
    try {
      const success = await onActivate(licenseKey);
      
      if (!success) {
        setError('Die Aktivierung ist fehlgeschlagen. Bitte überprüfen Sie Ihren Lizenzschlüssel.');
      }
    } catch (err) {
      setError('Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.');
      console.error('Aktivierungsfehler:', err);
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-4">Lizenz aktivieren</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label htmlFor="licenseKey" className="block text-sm font-medium text-gray-700 mb-1">
            Lizenzschlüssel
          </label>
          <input
            type="text"
            id="licenseKey"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="SF-XXXX-XXXX-XXXX"
            disabled={isActivating}
          />
        </div>
        
        {error && (
          <div className="mb-4 text-sm text-red-600">
            {error}
          </div>
        )}
        
        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
            disabled={isActivating}
          >
            Abbrechen
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:bg-blue-400"
            disabled={isActivating}
          >
            {isActivating ? 'Aktiviere...' : 'Aktivieren'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default LicenseActivation;
