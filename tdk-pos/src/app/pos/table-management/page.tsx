import PosPage from "../page";
import TableManagementView from "./TableManagementView";

export default function TableManagementPage() {
  return <>
    <PosPage />
    <TableManagementView modal closeToPos />
  </>;
}
