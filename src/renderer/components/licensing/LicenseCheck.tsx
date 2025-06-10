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

  // Wenn keine gültige Lizenz oder kein aktiver Trial vorhanden ist, zeigen wir die Lizenzseite an
  if (!isLicensed && !isInTrial) {
    return <LicensePage />;
  }

  // Wenn eine gültige Lizenz oder ein aktiver Trial vorhanden ist, zeigen wir die App an
  return <>{children}</>;
};

export default LicenseCheck;
