interface Window {
  desktop?: {
    saveCsv(csv: string): Promise<boolean>;
    saveXlsx(bytes: number[]): Promise<boolean>;
    printReport(): Promise<boolean>;
    previewPdf(bytes: number[]): Promise<boolean>;
  };
}
