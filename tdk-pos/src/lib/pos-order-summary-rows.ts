export type SummarySourceItem = {
  orderId: number;
  orderItemId: number;
  parentOrderItemId: number | null;
  menuId: number;
  itemType: "NORMAL" | "COMPONENT" | "SERVICE";
  itemName: string;
  unitPrice: string;
  actualComponentQty?: number | null;
  totalAmount?: string;
  effectiveQty: number;
  qty?: number;
  options?: Array<{
    modifierOptionId: number | null;
    optionName: string;
    qty: number;
    unitPrice: string;
    independentQty?: boolean;
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
  sourceOrderItemIds?: number[];
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

const effectiveSourceAmount = (item: SummarySourceItem) => {
  if (item.itemType === "SERVICE") return 0;
  const sourceTotal = Number(item.totalAmount);
  const independentAddons = (item.options ?? []).filter(option => option.independentQty)
    .reduce((sum, option) => sum + Number(option.unitPrice) * option.qty, 0);
  const baseTotal = Number.isFinite(sourceTotal) && item.qty && item.qty > 0
    ? sourceTotal - independentAddons
    : Number(item.unitPrice) * (item.qty ?? item.effectiveQty);
  return baseTotal * item.effectiveQty / Math.max(1, item.qty ?? item.effectiveQty) + independentAddons;
};

const optionSignature = (item: SummarySourceItem) => (item.options ?? [])
  .map(option => [option.modifierOptionId, option.optionName, Number(option.unitPrice),
    option.independentQty ? option.qty : option.qty / Math.max(1, item.qty ?? item.effectiveQty)])
  .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const actualUnitAmountCents = (item: SummarySourceItem) => Math.round(
  effectiveSourceAmount(item) * 100 / Math.max(1, item.effectiveQty),
);

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
  const componentsByParent = new Map<number, SummarySourceItem[]>();
  for (const item of items) {
    if (item.itemType !== "COMPONENT" || item.parentOrderItemId === null) continue;
    const children = componentsByParent.get(item.parentOrderItemId) ?? [];
    children.push(item);
    componentsByParent.set(item.parentOrderItemId, children);
  }
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
    const optionLabel = sortedOptions.map(option => `${option.optionName}${option.independentQty && option.qty > 1 ? ` ×${option.qty}` : ""}`).join(", ");
    const childComposition = (componentsByParent.get(item.orderItemId) ?? []).reduce((composition, child) => {
      const childIdentity = JSON.stringify([child.itemType, child.menuId, Number(child.unitPrice), optionSignature(child)]);
      const configuredQty = child.actualComponentQty ?? child.qty ?? child.effectiveQty;
      composition.set(childIdentity, (composition.get(childIdentity) ?? 0) + configuredQty);
      return composition;
    }, new Map<string, number>());
    const componentSignature = [...childComposition]
      .map(([identity, configuredQty]) => [identity, configuredQty / Math.max(1, item.qty ?? item.effectiveQty)])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const rowKey = JSON.stringify([item.itemType, item.menuId, unitPrice, actualUnitAmountCents(item),
      optionSignature(item), componentSignature]);
    const sequence = { orderId: item.orderId, orderItemId: item.orderItemId };
    const row = rows.get(rowKey) ?? { rowKey, orderSequence: sequence, name: item.itemName, qty: 0, total: 0, unitPrice, itemType: item.itemType, components: [], optionLabel, sourceOrderItemIds: [] };
    if (compareOrderSequence(sequence, row.orderSequence) < 0) row.orderSequence = sequence;
    row.qty += item.effectiveQty;
    row.total += effectiveSourceAmount(item);
    row.sourceOrderItemIds!.push(item.orderItemId);
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
      orphanComponents.push({ rowKey, orderSequence: { orderId: item.orderId, orderItemId: item.orderItemId }, name: item.itemName, qty: item.effectiveQty, total: unitPrice * item.effectiveQty, unitPrice, itemType: item.itemType, components: [] });
      continue;
    }
    const parentChildren = children.get(parentRowKey) ?? new Map<string, SummaryRow>();
    const childOptions = optionSignature(item);
    const rowKey = `component:${JSON.stringify([item.menuId, unitPrice, childOptions])}`;
    const row = parentChildren.get(rowKey) ?? {
      rowKey,
      orderSequence: { orderId: item.orderId, orderItemId: item.orderItemId },
      name: item.itemName,
      qty: 0,
      total: 0,
      unitPrice,
      components: [],
      sourceOrderItemIds: [],
    };
    if (compareOrderSequence({ orderId: item.orderId, orderItemId: item.orderItemId }, row.orderSequence) < 0) {
      row.orderSequence = { orderId: item.orderId, orderItemId: item.orderItemId };
    }
    row.qty += item.effectiveQty;
    row.total += effectiveSourceAmount(item);
    row.sourceOrderItemIds!.push(item.orderItemId);
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
