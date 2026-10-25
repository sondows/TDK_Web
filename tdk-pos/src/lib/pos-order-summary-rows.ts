export type SummarySourceItem = {
  orderId: number;
  orderItemId: number;
  parentOrderItemId: number | null;
  menuId: number;
  itemType: "NORMAL" | "COMPONENT" | "SERVICE";
  itemName: string;
  unitPrice: string;
  totalAmount?: string;
  effectiveQty: number;
  qty?: number;
  options?: Array<{
    modifierOptionId: number | null;
    optionName: string;
    qty: number;
    unitPrice: string;
  }>;
};

export type SummaryRow = {
  rowKey: string;
  orderSequence: { orderId: number; orderItemId: number };
  name: string;
  qty: number;
  total: number;
  unitPrice: number;
  itemType?: "NORMAL" | "COMPONENT" | "SERVICE";
  components: SummaryRow[];
  optionLabel?: string;
};

const compareOrderSequence = (
  left: SummaryRow["orderSequence"],
  right: SummaryRow["orderSequence"],
) => left.orderId - right.orderId || left.orderItemId - right.orderItemId;

export type PartySummarySourceItem = SummarySourceItem & {
  sessionId: number;
  discountAmount: string;
  options: Array<{
    modifierOptionId: number | null;
    optionName: string;
    qty: number;
    unitPrice: string;
  }>;
};

const effectiveSourceAmount = (item: PartySummarySourceItem) => {
  if (item.itemType === "SERVICE") return 0;
  const sourceTotal = Number(item.totalAmount);
  if (Number.isFinite(sourceTotal) && item.qty && item.qty > 0)
    return sourceTotal * item.effectiveQty / item.qty;
  return Number(item.unitPrice) * item.effectiveQty;
};

/** Groups party display rows by menu identity and actual unit selling price. */
export function buildPartyOrderRows(items: PartySummarySourceItem[]): SummaryRow[] {
  const activeParents = items.filter(
    (item) => item.itemType !== "COMPONENT" && item.effectiveQty > 0,
  );
  const componentsByParent = new Map<number, PartySummarySourceItem[]>();
  for (const item of items) {
    if (item.itemType !== "COMPONENT" || item.parentOrderItemId === null) continue;
    const rows = componentsByParent.get(item.parentOrderItemId) ?? [];
    rows.push(item);
    componentsByParent.set(item.parentOrderItemId, rows);
  }
  const grouped = new Map<string, SummaryRow>();
  for (const parent of activeParents) {
    const childItems = componentsByParent.get(parent.orderItemId) ?? [];
    const childGroups = new Map<string, { item: PartySummarySourceItem; qty: number; total: number }>();
    for (const child of childItems) {
      const childKey = JSON.stringify([child.menuId, Number(child.unitPrice)]);
      const current = childGroups.get(childKey) ?? { item: child, qty: 0, total: 0 };
      current.qty += child.effectiveQty;
      current.total += effectiveSourceAmount(child);
      childGroups.set(childKey, current);
    }
    const unitPrice = Number(parent.unitPrice);
    const rowKey = JSON.stringify([parent.menuId, unitPrice]);
    const row = grouped.get(rowKey) ?? {
      rowKey,
      orderSequence: { orderId: parent.orderId, orderItemId: parent.orderItemId },
      name: parent.itemName,
      qty: 0,
      total: 0,
      unitPrice,
      itemType: parent.itemType,
      components: [],
    };
    if (
      compareOrderSequence(
        { orderId: parent.orderId, orderItemId: parent.orderItemId },
        row.orderSequence,
      ) < 0
    ) {
      row.orderSequence = { orderId: parent.orderId, orderItemId: parent.orderItemId };
    }
    row.qty += parent.effectiveQty;
    row.total += effectiveSourceAmount(parent);
    for (const { item, qty, total } of childGroups.values()) {
      const childKey = `component:${JSON.stringify([item.menuId, Number(item.unitPrice)])}`;
      const childRow = row.components.find((component) => component.rowKey === childKey);
      if (childRow) {
        childRow.qty += qty;
        childRow.total += total;
      } else {
        row.components.push({
          rowKey: childKey,
          orderSequence: { orderId: item.orderId, orderItemId: item.orderItemId },
          name: item.itemName,
          qty,
          total,
          unitPrice: Number(item.unitPrice),
          components: [],
        });
      }
    }
    grouped.set(rowKey, row);
  }
  return [...grouped.values()].sort(
    (a, b) => compareOrderSequence(a.orderSequence, b.orderSequence),
  );
}

export function buildOrderSummaryRows(items: SummarySourceItem[]): SummaryRow[] {
  const rows = new Map<string, SummaryRow>();
  const parentRowKeys = new Map<number, string>();
  const components: SummarySourceItem[] = [];
  const parentsWithComponents = new Set(
    items
      .filter((item) => item.itemType === "COMPONENT" && item.parentOrderItemId !== null)
      .map((item) => item.parentOrderItemId!),
  );
  for (const item of items) {
    if (item.effectiveQty <= 0) continue;
    if (item.itemType === "COMPONENT" && item.parentOrderItemId !== null) {
      components.push(item);
      continue;
    }
    const unitPrice = Number(item.unitPrice);
    const sortedOptions = (item.options ?? []).slice().sort((left, right) =>
      (left.modifierOptionId ?? 0) - (right.modifierOptionId ?? 0) || left.optionName.localeCompare(right.optionName, "ko"),
    );
    const optionLabel = sortedOptions.map(option => option.optionName).join(", ");
    const optionSignature = sortedOptions.map(option => [option.modifierOptionId, option.optionName, Number(option.unitPrice), option.qty / Math.max(1, item.qty ?? item.effectiveQty)]);
    const rowKey = parentsWithComponents.has(item.orderItemId)
      ? `parent:${item.orderItemId}`
      : JSON.stringify([item.itemType, item.menuId, item.itemName, unitPrice, optionSignature]);
    const sequence = { orderId: item.orderId, orderItemId: item.orderItemId };
    const row = rows.get(rowKey) ?? { rowKey, orderSequence: sequence, name: item.itemName, qty: 0, total: 0, unitPrice, itemType: item.itemType, components: [], optionLabel };
    if (compareOrderSequence(sequence, row.orderSequence) < 0) row.orderSequence = sequence;
    row.qty += item.effectiveQty;
    row.total += (item.itemType === "SERVICE" ? 0 : unitPrice) * item.effectiveQty;
    rows.set(rowKey, row);
    parentRowKeys.set(item.orderItemId, rowKey);
  }
  const children = new Map<string, Map<string, SummaryRow>>();
  const orphanComponents: SummaryRow[] = [];
  for (const item of components) {
    const parentRowKey = parentRowKeys.get(item.parentOrderItemId!);
    const parent = parentRowKey ? rows.get(parentRowKey) : undefined;
    const unitPrice = Number(item.unitPrice);
    if (!parent || !parentRowKey) {
      const rowKey = `component:${item.orderItemId}`;
      orphanComponents.push({ rowKey, orderSequence: { orderId: item.orderId, orderItemId: item.orderItemId }, name: item.itemName, qty: item.effectiveQty, total: unitPrice * item.effectiveQty, unitPrice, components: [] });
      continue;
    }
    const rowKey = `component:${item.orderItemId}`;
    const parentChildren = children.get(parentRowKey) ?? new Map<string, SummaryRow>();
    const row = { rowKey, orderSequence: { orderId: item.orderId, orderItemId: item.orderItemId }, name: item.itemName, qty: item.effectiveQty, total: unitPrice * item.effectiveQty, unitPrice, components: [] };
    parentChildren.set(rowKey, row);
    children.set(parentRowKey, parentChildren);
  }
  for (const [parentRowKey, parentChildren] of children) {
    const parent = rows.get(parentRowKey);
    if (parent) parent.components = [...parentChildren.values()];
  }
  return [...rows.values(), ...orphanComponents].sort(
    (a, b) => compareOrderSequence(a.orderSequence, b.orderSequence),
  );
}
