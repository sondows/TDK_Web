type PartyTable = {
  tableId: number;
  tableNo: string;
  sessionId: number | null;
  groupId: number | null;
};

export function partyPeerTableNos(table: PartyTable, tables: PartyTable[]): string[] {
  if (table.sessionId === null || table.groupId === null) return [];
  return tables
    .filter(peer => peer.sessionId !== null && peer.tableId !== table.tableId && peer.groupId === table.groupId)
    .map(peer => peer.tableNo)
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}
