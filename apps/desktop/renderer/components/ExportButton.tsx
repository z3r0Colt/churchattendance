import { useState } from "react";
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
} from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { exportCsv, exportXlsx, type ExportRow } from "../data/export";
export function ExportButton({
  rows,
  onXlsx,
}: {
  rows: ExportRow[];
  onXlsx?: () => Promise<unknown>;
}) {
  const [error, setError] = useState(false);
  async function save(format: "csv" | "xlsx") {
    try {
      await (format === "csv"
        ? exportCsv(rows)
        : onXlsx
          ? onXlsx()
          : exportXlsx(rows));
    } catch {
      setError(true);
    }
  }
  return (
    <>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button icon={<ArrowDownloadRegular />} disabled={!rows.length}>
            Export
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => void save("csv")}>CSV</MenuItem>
            <MenuItem onClick={() => void save("xlsx")}>
              Excel workbook
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {error && (
        <MessageBar intent="error">
          The export could not be saved. Try again.
        </MessageBar>
      )}
    </>
  );
}
