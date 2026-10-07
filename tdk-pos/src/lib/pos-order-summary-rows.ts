export type SummarySourceItem = {
  orderId: number;
  orderItemId: number;
  parentOrderItemId: number | null;
  menuId: number;
  itemType: "NORMAL" | "COMPONENT" | "SERVICE";
  itemName: string;
  unitPrice: string;
  effectiveQty: number;
};

export type SummaryRow = {
  rowKey: string;
  orderSequence: { orderId: number; orderItemId: number };
  name: string;
  qty: number;
  total: number;
  unitPrice: number;
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

export type PartySummaryDiscount = {
  sessionId: number;
  discountType: string;
  label: string;
  discountAmount: string;
  discountRate: number | null;
};

const gcd = (left: number, right: number): number => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
};

/** Groups party display rows only when menu, price/discount/options, and actual component ratios match. */
export function buildPartyOrderRows(
  items: PartySummarySourceItem[],
  discounts: PartySummaryDiscount[],
): SummaryRow[] {
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
  const discountsBySession = new Map<number, string>();
  for (const sessionId of new Set(items.map((item) => item.sessionId))) {
    const condition = discounts
      .filter((discount) => discount.sessionId === sessionId)
      .map((discount) => [
        discount.discountType,
        discount.label,
        Number(discount.discountAmount),
        discount.discountRate,
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    discountsBySession.set(sessionId, JSON.stringify(condition));
  }

  const grouped = new Map<string, SummaryRow>();
  for (const parent of activeParents) {
    const childItems = componentsByParent.get(parent.orderItemId) ?? [];
    const childGroups = new Map<string, { item: PartySummarySourceItem; qty: number }>();
    for (const child of childItems) {
      const childDiscountPerUnit = Number(child.discountAmount) / Math.max(1, child.effectiveQty);
      const childKey = `${child.menuId}:${Number(child.unitPrice)}:${childDiscountPerUnit}`;
      const current = childGroups.get(childKey) ?? { item: child, qty: 0 };
      current.qty += child.effectiveQty;
      childGroups.set(childKey, current);
    }
    const componentState = [...childGroups.values()]
      .map(({ item, qty }) => {
        const divisor = gcd(qty, parent.effectiveQty);
        const discountPerUnit = Number(item.discountAmount) / Math.max(1, item.effectiveQty);
        return [item.menuId, Number(item.unitPrice), discountPerUnit, qty / divisor, parent.effectiveQty / divisor];
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const options = parent.options
      .map((option) => [option.modifierOptionId, option.optionName, option.qty, Number(option.unitPrice)])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const unitPrice = Number(parent.unitPrice);
    const perUnitDiscount = Number(parent.discountAmount) / parent.effectiveQty;
    const rowKey = JSON.stringify([
      parent.itemType,
      parent.menuId,
      unitPrice,
      perUnitDiscount,
      discountsBySession.get(parent.sessionId) ?? "[]",
      options,
      componentState,
    ]);
    const optionLabel = parent.options
      .slice()
      .sort(
        (a, b) =>
          (a.modifierOptionId ?? 0) - (b.modifierOptionId ?? 0) ||
          a.optionName.localeCompare(b.optionName, "ko"),
      )
      .map((option) => option.optionName)
      .join(", ");
    const row = grouped.get(rowKey) ?? {
      rowKey,
      orderSequence: { orderId: parent.orderId, orderItemId: parent.orderItemId },
      name: parent.itemName,
      qty: 0,
      total: 0,
      unitPrice,
      components: [],
      optionLabel,
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
    row.total += unitPrice * parent.effectiveQty;
    for (const { item, qty } of childGroups.values()) {
      const discountPerUnit = Number(item.discountAmount) / Math.max(1, item.effectiveQty);
      const childKey = `component:${item.menuId}:${Number(item.unitPrice)}:${discountPerUnit}`;
      const childRow = row.components.find((component) => component.rowKey === childKey);
      if (childRow) {
        childRow.qty += qty;
        childRow.total += Number(item.unitPrice) * qty;
      } else {
        row.components.push({
          rowKey: childKey,
          orderSequence: { orderId: item.orderId, orderItemId: item.orderItemId },
          name: item.itemName,
          qty,
          total: Number(item.unitPrice) * qty,
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
    const rowKey = parentsWithComponents.has(item.orderItemId)
      ? `parent:${item.orderItemId}`
      : `${item.itemType.toLowerCase()}:${item.menuId}:${unitPrice}`;
    const sequence = { orderId: item.orderId, orderItemId: item.orderItemId };
    const row = rows.get(rowKey) ?? { rowKey, orderSequence: sequence, name: item.itemName, qty: 0, total: 0, unitPrice, components: [] };
    if (compareOrderSequence(sequence, row.orderSequence) < 0) row.orderSequence = sequence;
    row.qty += item.effectiveQty;
    row.total += unitPrice * item.effectiveQty;
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
