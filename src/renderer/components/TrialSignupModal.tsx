import React, { useState } from 'react';
import { ipcRenderer } from 'electron';

interface TrialSignupModalProps {
  onComplete: () => void;
}

const TrialSignupModal: React.FC<TrialSignupModalProps> = ({ onComplete }) => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !email.includes('@')) {
      setError('Bitte geben Sie eine gültige E-Mail-Adresse ein.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // IPC-Aufruf an den Main-Prozess, um den Trial zu aktivieren
      const result = await ipcRenderer.invoke('activate-trial', { email });
      
      if (result.success) {
        onComplete();
      } else {
        setError(result.error || 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.');
      }
    } catch (err) {
      setError('Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.');
      console.error('Trial-Aktivierungsfehler:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="trial-signup-modal">
      <div className="modal-content">
        <h2>Willkommen bei SwitchFast!</h2>
        <p>Beginnen Sie Ihre 7-tägige kostenlose Testversion.</p>
        
        {error && <div className="error-message">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">E-Mail-Adresse</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ihre E-Mail-Adresse"
              required
            />
          </div>
          
          <button 
            type="submit" 
            className="primary-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Wird aktiviert...' : 'Trial starten'}
          </button>
        </form>
        
        <p className="terms">
          Mit der Aktivierung des Trials stimmen Sie unseren 
          <a href="https://switchfast.io/terms" target="_blank" rel="noopener noreferrer">Nutzungsbedingungen</a> 
          und <a href="https://switchfast.io/privacy" target="_blank" rel="noopener noreferrer">Datenschutzrichtlinien</a> zu.
        </p>
      </div>
    </div>
  );
};

export default TrialSignupModal;
