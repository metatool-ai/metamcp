"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getAppUrl } from "@/lib/env";

interface DomainWarningBannerProps {
  className?: string;
}

export function DomainWarningBanner({
  className = "",
}: DomainWarningBannerProps) {
  const [showDomainWarning, setShowDomainWarning] = useState(false);
  const [domainInfo, setDomainInfo] = useState<{
    current: string;
    expected: string;
  } | null>(null);

  // Function to check domain validation
  const checkDomainValidation = () => {
    try {
      const configuredAppUrl = getAppUrl();
      const currentOrigin = window.location.origin;
      const configuredOrigin = new URL(configuredAppUrl).origin;

      if (currentOrigin !== configuredOrigin) {
        setShowDomainWarning(true);
        setDomainInfo({
          current: currentOrigin,
          expected: configuredOrigin,
        });
        return false;
      }
      setShowDomainWarning(false);
      setDomainInfo(null);
      return true;
    } catch (error) {
      console.error("Error checking domain validation:", error);
      // If we can't check, don't show warning (fail open)
      setShowDomainWarning(false);
      setDomainInfo(null);
      return true;
    }
  };

  // Check domain validation once on load
  useEffect(() => {
    checkDomainValidation();
  }, []);

  const handleDismissWarning = () => {
    setShowDomainWarning(false);
  };

  const handleViewDetails = () => {
    const corsErrorUrl = new URL("/cors-error", window.location.origin);
    corsErrorUrl.searchParams.set(
      "callbackUrl",
      window.location.pathname + window.location.search,
    );
    window.location.href = corsErrorUrl.toString();
  };

  if (!showDomainWarning || !domainInfo) {
    return null;
  }

  return (
    <Alert className={`mb-6 ${className}`} variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Domain Mismatch Warning</AlertTitle>
      <AlertDescription>
        <div className="mt-2">
          <p>
            You&apos;re accessing this app from{" "}
            <span className="font-mono font-semibold">
              {domainInfo.current}
            </span>{" "}
            but it&apos;s configured for{" "}
            <span className="font-mono font-semibold">
              {domainInfo.expected}
            </span>
            .
          </p>
          <div className="mt-3 flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleViewDetails}
              className="h-auto p-0 text-sm underline"
            >
              View Details
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDismissWarning}
              className="h-auto p-0 text-sm"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
