import React, { useEffect, useState } from "react";
import { useLicense } from "../../hooks/useLicense";
import LicensePage from "./LicensePage";

interface LicenseCheckProps {
  children: React.ReactNode;
}

const LicenseCheck: React.FC<LicenseCheckProps> = ({ children }) => {
  const { isLicensed, isInTrial, isLoading, checkLicenseStatus } = useLicense();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const verifyLicense = async () => {
      setIsChecking(true);
      await checkLicenseStatus();
      setIsChecking(false);
    };

    verifyLicense();
  }, [checkLicenseStatus]);

  if (isLoading || isChecking) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-300">Lizenz wird überprüft...</p>
        </div>
      </div>
    );
  }

  // Wenn keine gültige Lizenz oder kein aktiver Trial vorhanden ist, zeigen wir die Lizenzseite an
  if (!isLicensed && !isInTrial) {
    return <LicensePage />;
  }

  // Wenn eine gültige Lizenz oder ein aktiver Trial vorhanden ist, zeigen wir die App an
  return <>{children}</>;
};

export default LicenseCheck;
