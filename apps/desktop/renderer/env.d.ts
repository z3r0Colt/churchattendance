interface Window {
  desktop?: {
    openStaffSecurity(id: string, challenge: string): Promise<void>;
    setKioskMode(enabled: boolean): Promise<void>;
    saveReportPdf(title: string, html: string): Promise<boolean>;
    saveCsv(csv: string): Promise<boolean>;
    saveXlsx(
      bytes: number[],
      filename?: "sycamore-archive.xlsx",
    ): Promise<boolean>;
    printReport(): Promise<boolean>;
    previewPdf(bytes: number[]): Promise<boolean>;
  };
}
