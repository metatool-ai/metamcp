"use client";

import { RestApiImportRequest } from "@repo/zod-types";
import { Edit3, FileText, Globe, Upload } from "lucide-react";
import { useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "@/hooks/useTranslations";

import { ManualApiForm } from "./rest-api/manual-api-form";
import { OpenApiImportForm } from "./rest-api/openapi-import-form";
import { SimpleJsonImportForm } from "./rest-api/simple-json-import-form";

interface RestApiImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (request: RestApiImportRequest) => Promise<void>;
}

type ImportStep = "select-format" | "configure-api";
type ImportFormat = "manual" | "openapi" | "simple_json";

export function RestApiImportDialog({
  isOpen,
  onClose,
  onImport,
}: RestApiImportDialogProps) {
  const { t } = useTranslations();
  const [step, setStep] = useState<ImportStep>("select-format");
  const [selectedFormat, setSelectedFormat] = useState<ImportFormat | null>(
    null,
  );
  const [isImporting, setIsImporting] = useState(false);

  const handleClose = () => {
    setStep("select-format");
    setSelectedFormat(null);
    setIsImporting(false);
    onClose();
  };

  const handleFormatSelect = (format: ImportFormat) => {
    setSelectedFormat(format);
    setStep("configure-api");
  };

  const handleBack = () => {
    setStep("select-format");
    setSelectedFormat(null);
  };

  const handleImport = async (data: any) => {
    if (!selectedFormat) return;

    setIsImporting(true);
    try {
      const request: RestApiImportRequest = {
        format: selectedFormat as any,
        data,
        server_name: data.name || "REST API Server",
        server_description: data.description,
      };

      await onImport(request);
      handleClose();
    } catch (error) {
      console.error("Import failed:", error);
    } finally {
      setIsImporting(false);
    }
  };

  const renderFormatSelection = () => (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">
          {t("rest-api:selectImportFormat")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("rest-api:selectImportFormatDescription")}
        </p>
      </div>

      <div className="grid gap-4">
        <Card
          className="cursor-pointer hover:bg-accent transition-colors"
          onClick={() => handleFormatSelect("manual")}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Edit3 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                {t("rest-api:manualEntry")}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <CardDescription>
              {t("rest-api:manualEntryDescription")}
            </CardDescription>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:bg-accent transition-colors"
          onClick={() => handleFormatSelect("openapi")}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Upload className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                {t("rest-api:openApiImport")}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <CardDescription>
              {t("rest-api:openApiImportDescription")}
            </CardDescription>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:bg-accent transition-colors"
          onClick={() => handleFormatSelect("simple_json")}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                {t("rest-api:simpleJsonImport")}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <CardDescription>
              {t("rest-api:simpleJsonImportDescription")}
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderConfigurationForm = () => {
    if (!selectedFormat) return null;

    switch (selectedFormat) {
      case "manual":
        return (
          <ManualApiForm
            onSubmit={handleImport}
            onCancel={handleBack}
            isLoading={isImporting}
          />
        );
      case "openapi":
        return (
          <OpenApiImportForm
            onSubmit={handleImport}
            onCancel={handleBack}
            isLoading={isImporting}
          />
        );
      case "simple_json":
        return (
          <SimpleJsonImportForm
            onSubmit={handleImport}
            onCancel={handleBack}
            isLoading={isImporting}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("rest-api:importRestApi")}
          </DialogTitle>
          <DialogDescription>
            {step === "select-format"
              ? t("rest-api:importRestApiDescription")
              : t("rest-api:configureApiDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {step === "select-format" && renderFormatSelection()}
          {step === "configure-api" && renderConfigurationForm()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
