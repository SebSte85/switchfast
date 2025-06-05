import React, { useState } from 'react';
import LicenseCheck from './licensing/LicenseCheck';
import LicenseSettings from './licensing/LicenseSettings';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'main' | 'settings'>('main');

  // Hier würde der Hauptinhalt Ihrer App stehen
  const MainContent = () => (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">SwitchFast</h1>
      <p className="mb-4">Willkommen bei SwitchFast! Ihre Lizenz ist aktiv.</p>
      
      <div className="mt-8">
        <button
          onClick={() => setCurrentView('settings')}
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 transition-colors"
        >
          Lizenzeinstellungen öffnen
        </button>
      </div>
    </div>
  );

  return (
    <LicenseCheck>
      <div className="min-h-screen bg-gray-100">
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center">
              <h1 className="text-xl font-bold text-gray-900">SwitchFast</h1>
              
              <nav className="flex space-x-4">
                <button
                  onClick={() => setCurrentView('main')}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    currentView === 'main'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setCurrentView('settings')}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    currentView === 'settings'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Lizenz
                </button>
              </nav>
            </div>
          </div>
        </header>
        
        <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          {currentView === 'main' ? <MainContent /> : <LicenseSettings />}
        </main>
      </div>
    </LicenseCheck>
  );
};

export default App;
