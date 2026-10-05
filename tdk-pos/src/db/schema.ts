import { sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";

import {
  mysqlTable,
  bigint,
  varchar,
  int,
  tinyint,
  datetime,
  date,
  decimal,
  text,
  index,
  primaryKey,
  uniqueIndex,
  mysqlEnum,
} from "drizzle-orm/mysql-core";

export const diningTables = mysqlTable(
  "dining_tables",
  {
    tableId: bigint("table_id", {
      mode: "number",
      unsigned: true,
    })
      .autoincrement()
      .primaryKey(),

    tableNo: varchar("table_no", { length: 20 }).notNull(),

    tableName: varchar("table_name", { length: 100 }),

    capacity: int("capacity").notNull().default(0),

    positionX: decimal("position_x", { precision: 5, scale: 2 }),
    positionY: decimal("position_y", { precision: 5, scale: 2 }),
    layoutWidth: decimal("layout_width", { precision: 5, scale: 2 }),
    layoutHeight: decimal("layout_height", { precision: 5, scale: 2 }),
    rotation: int("rotation").notNull().default(0),

    sortOrder: int("sort_order").notNull().default(0),

    isActive: tinyint("is_active").notNull().default(1),

    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("uq_dining_table_no").on(table.tableNo),
  ]
);

export const staff = mysqlTable(
  "staff",
  {
    staffId: bigint("staff_id", {
      mode: "number",
      unsigned: true,
    })
      .autoincrement()
      .primaryKey(),
    staffCode: varchar("staff_code", { length: 30 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    pinHash: varchar("pin_hash", { length: 255 }),
    adminLoginId: varchar("admin_login_id", { length: 32 }),
    adminPinHash: varchar("admin_pin_hash", { length: 255 }),
    role: mysqlEnum("role", ["OWNER", "MANAGER", "STAFF"])
      .notNull()
      .default("STAFF"),
    isActive: tinyint("is_active").notNull().default(1),
    cancelRequiresPin: tinyint("cancel_requires_pin").notNull().default(1),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("uq_staff_code").on(table.staffCode),
    uniqueIndex("uq_staff_admin_login_id").on(table.adminLoginId),
  ]
);

export const customers = mysqlTable(
  "customers",
  {
    customerId: bigint("customer_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    contactName: varchar("contact_name", { length: 100 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 255 }),
    memo: text("memo"),
    isPaymentManaged: tinyint("is_payment_managed").notNull().default(0),
    usesFixedCoupon: tinyint("uses_fixed_coupon").notNull().default(0),
    fixedCouponAmount: decimal("fixed_coupon_amount", { precision: 14, scale: 2 }),
    fixedCouponBalancePolicy: mysqlEnum("fixed_coupon_balance_policy", ["CASH_CHANGE", "FORFEIT"]).notNull().default("FORFEIT"),
    fixedCouponCashChangeEnabled: tinyint("fixed_coupon_cash_change_enabled").notNull().default(0),
    fixedCouponCashChangeMinPercent: tinyint("fixed_coupon_cash_change_min_percent", { unsigned: true }),
    sortOrder: int("sort_order").notNull().default(0),
    isActive: tinyint("is_active").notNull().default(1),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_customers_name").on(table.name),
    index("idx_customers_phone").on(table.phone),
  ]
);

export const staffSessions = mysqlTable("staff_sessions", {
  staffSessionId: bigint("staff_session_id", {
    mode: "number",
    unsigned: true,
  })
    .autoincrement()
    .primaryKey(),
  staffId: bigint("staff_id", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  deviceId: bigint("device_id", {
    mode: "number",
    unsigned: true,
  }),
  sessionTokenHash: varchar("session_token_hash", { length: 255 }),
  loggedInAt: datetime("logged_in_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  lastActiveAt: datetime("last_active_at"),
  loggedOutAt: datetime("logged_out_at"),
  status: mysqlEnum("status", ["ACTIVE", "LOGGED_OUT", "EXPIRED"])
    .notNull()
    .default("ACTIVE"),
});

export const systemSettings = mysqlTable("system_settings", {
  settingKey: varchar("setting_key", { length: 100 }).primaryKey(),
  settingValue: varchar("setting_value", { length: 255 }).notNull(),
  updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedByStaffId: bigint("updated_by_staff_id", { mode: "number", unsigned: true }),
});

/** Master definitions for reusable discounts. POS quick presets use slots 1 through 4. */
export const discountRules = mysqlTable(
  "discount_rules",
  {
    discountRuleId: bigint("discount_rule_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    posPresetSlot: tinyint("pos_preset_slot", { unsigned: true }),
    discountCode: varchar("discount_code", { length: 40 }).notNull(),
    discountName: varchar("discount_name", { length: 150 }).notNull(),
    discountType: mysqlEnum("discount_type", ["RATE", "AMOUNT", "FREE_ITEM"]).notNull(),
    discountValue: decimal("discount_value", { precision: 14, scale: 2 }).notNull().default("0.00"),
    maxDiscountAmount: decimal("max_discount_amount", { precision: 14, scale: 2 }),
    minOrderAmount: decimal("min_order_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
    requiresManager: tinyint("requires_manager").notNull().default(0),
    startAt: datetime("start_at"),
    endAt: datetime("end_at"),
    isActive: tinyint("is_active").notNull().default(1),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("uq_discount_rule_code").on(table.discountCode),
    uniqueIndex("uq_discount_rules_pos_preset_slot").on(table.posPresetSlot),
    index("idx_discount_rules_pos_preset_active").on(table.posPresetSlot, table.isActive),
  ]
);

export const partyGroups = mysqlTable("party_groups", {
  groupId: bigint("group_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  status: mysqlEnum("status", ["ACTIVE", "RELEASED"]).notNull().default("ACTIVE"),
  createdByStaffId: bigint("created_by_staff_id", { mode: "number", unsigned: true }),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  releasedAt: datetime("released_at"),
});

export const tableSessions = mysqlTable("table_sessions", {
  sessionId: bigint("session_id", {
    mode: "number",
    unsigned: true,
  })
    .autoincrement()
    .primaryKey(),

  tableId: bigint("table_id", {
    mode: "number",
    unsigned: true,
  }).notNull(),

  groupId: bigint("group_id", {
    mode: "number",
    unsigned: true,
  }),

  personCount: int("person_count").notNull().default(0),

  babyCount: int("baby_count").notNull().default(0),

  status: mysqlEnum("status", [
    "OPEN",
    "CLOSED",
    "CANCELLED",
  ])
    .notNull()
    .default("OPEN"),

  openedByStaffId: bigint("opened_by_staff_id", {
    mode: "number",
    unsigned: true,
  }),

  closedByStaffId: bigint("closed_by_staff_id", {
    mode: "number",
    unsigned: true,
  }),

  openedAt: datetime("opened_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),

  closedAt: datetime("closed_at"),

  note: varchar("note", { length: 500 }),
});

export const menuCategories = mysqlTable("menu_categories", {
  categoryId: bigint("category_id", {
    mode: "number",
    unsigned: true,
  })
    .autoincrement()
    .primaryKey(),
  posName: varchar("pos_name", { length: 100 }).notNull(),
  sortOrder: int("sort_order").notNull().default(0),
  isActive: tinyint("is_active").notNull().default(1),
});

export const menus = mysqlTable("menus", {
  menuId: bigint("menu_id", {
    mode: "number",
    unsigned: true,
  })
    .autoincrement()
    .primaryKey(),
  menuCode: varchar("menu_code", { length: 40 }).notNull(),
  posName: varchar("pos_name", { length: 150 }).notNull(),
  categoryId: bigint("category_id", {
    mode: "number",
    unsigned: true,
  }),
  price: decimal("price", { precision: 14, scale: 2 }).notNull().default("0"),
  prepStationId: bigint("prep_station_id", {
    mode: "number",
    unsigned: true,
  }),
  isActive: tinyint("is_active").notNull().default(1),
  isQrVisible: tinyint("is_qr_visible").notNull().default(1),
  countsAsPerson: tinyint("counts_as_person").notNull().default(0),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: datetime("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("uq_menu_code").on(table.menuCode)]);

export const menuImages = mysqlTable("menu_images", {
  menuImageId: bigint("menu_image_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  menuId: bigint("menu_id", { mode: "number", unsigned: true }).notNull().references(() => menus.menuId, { onDelete: "cascade" }),
  imageType: mysqlEnum("image_type", ["POS", "QR_THUMBNAIL", "QR_LARGE", "OTHER"]).notNull(),
  imageUrl: varchar("image_url", { length: 500 }).notNull(),
  sortOrder: int("sort_order").notNull().default(0),
  isActive: tinyint("is_active").notNull().default(1),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_menu_images_menu_type").on(table.menuId, table.imageType, table.isActive)]);

export const modifierGroups = mysqlTable("modifier_groups", {
  modifierGroupId: bigint("modifier_group_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  posName: varchar("pos_name", { length: 150 }).notNull(),
  minSelect: int("min_select").notNull().default(0),
  maxSelect: int("max_select").notNull().default(1),
  isRequired: tinyint("is_required").notNull().default(0),
  isActive: tinyint("is_active").notNull().default(1),
  sortOrder: int("sort_order").notNull().default(0),
});

export const modifierOptions = mysqlTable("modifier_options", {
  modifierOptionId: bigint("modifier_option_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  modifierGroupId: bigint("modifier_group_id", { mode: "number", unsigned: true }).notNull().references(() => modifierGroups.modifierGroupId, { onDelete: "cascade" }),
  posName: varchar("pos_name", { length: 150 }).notNull(),
  priceDelta: decimal("price_delta", { precision: 14, scale: 2 }).notNull().default("0.00"),
  linkedMenuId: bigint("linked_menu_id", { mode: "number", unsigned: true }).references(() => menus.menuId),
  sortOrder: int("sort_order").notNull().default(0),
  isActive: tinyint("is_active").notNull().default(1),
}, (table) => [index("idx_modifier_options_group").on(table.modifierGroupId, table.isActive)]);

export const menuModifierGroups = mysqlTable("menu_modifier_groups", {
  menuId: bigint("menu_id", { mode: "number", unsigned: true }).notNull().references(() => menus.menuId, { onDelete: "cascade" }),
  modifierGroupId: bigint("modifier_group_id", { mode: "number", unsigned: true }).notNull().references(() => modifierGroups.modifierGroupId, { onDelete: "cascade" }),
  sortOrder: int("sort_order").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.menuId, table.modifierGroupId] }), index("fk_menu_modifier_groups_group").on(table.modifierGroupId)]);

export const orders = mysqlTable("orders", {
  orderId: bigint("order_id", {
    mode: "number",
    unsigned: true,
  })
    .autoincrement()
    .primaryKey(),
  sessionId: bigint("session_id", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  orderType: mysqlEnum("order_type", ["POS", "QR", "OTHER"])
    .notNull()
    .default("POS"),
  status: mysqlEnum("status", ["OPEN", "ACCEPTED", "CANCELLED", "COMPLETED"])
    .notNull()
    .default("ACCEPTED"),
  subtotalAmount: decimal("subtotal_amount", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  discountAmount: decimal("discount_amount", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  createdByStaffId: bigint("created_by_staff_id", {
    mode: "number",
    unsigned: true,
  }),
  acceptedByStaffId: bigint("accepted_by_staff_id", {
    mode: "number",
    unsigned: true,
  }),
  orderedAt: datetime("ordered_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  acceptedAt: datetime("accepted_at"),
  note: varchar("note", { length: 500 }),
});

// A merge keeps both table sessions and their orders intact.  The source
// session is only hidden from the physical-table view while this row is ACTIVE.
export const tableSessionMerges = mysqlTable(
  "table_session_merges",
  {
    mergeId: bigint("merge_id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    sourceSessionId: bigint("source_session_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => tableSessions.sessionId),
    sourceTableId: bigint("source_table_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => diningTables.tableId),
    destinationSessionId: bigint("destination_session_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => tableSessions.sessionId),
    destinationTableId: bigint("destination_table_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => diningTables.tableId),
    status: mysqlEnum("status", ["ACTIVE", "SEPARATED"]).notNull().default("ACTIVE"),
    mergedByStaffId: bigint("merged_by_staff_id", { mode: "number", unsigned: true })
      .references(() => staff.staffId),
    mergedAt: datetime("merged_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    separatedAt: datetime("separated_at"),
  },
  (table) => [
    index("idx_table_session_merges_source_active").on(table.sourceSessionId, table.status),
    index("idx_table_session_merges_destination_active").on(table.destinationSessionId, table.status),
    index("idx_table_session_merges_source_table_active").on(table.sourceTableId, table.status),
  ]
);

/** Discounts are attached to a table session without changing original order prices. */
export const tableSessionDiscounts = mysqlTable(
  "table_session_discounts",
  {
    tableSessionDiscountId: bigint("table_session_discount_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    sessionId: bigint("session_id", { mode: "number", unsigned: true }).notNull().references(() => tableSessions.sessionId),
    discountType: mysqlEnum("discount_type", ["SNS_REVIEW", "AMOUNT", "PERCENT"]).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    discountAmount: decimal("discount_amount", { precision: 14, scale: 2 }).notNull(),
    discountRate: int("discount_rate"),
    appliedByStaffId: bigint("applied_by_staff_id", { mode: "number", unsigned: true }).references(() => staff.staffId),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_table_session_discounts_session").on(table.sessionId, table.createdAt)]
);

export const orderItems = mysqlTable("order_items", {
  orderItemId: bigint("order_item_id", {
    mode: "number",
    unsigned: true,
  })
    .autoincrement()
    .primaryKey(),
  orderId: bigint("order_id", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  parentOrderItemId: bigint("parent_order_item_id", {
    mode: "number",
    unsigned: true,
  }),
  menuId: bigint("menu_id", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  itemName: varchar("item_name", { length: 200 }).notNull(),
  qty: int("qty").notNull(),
  unitPrice: decimal("unit_price", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  discountAmount: decimal("discount_amount", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  prepStationId: bigint("prep_station_id", {
    mode: "number",
    unsigned: true,
  }),
  itemType: mysqlEnum("item_type", ["NORMAL", "COMPONENT", "SERVICE"])
    .notNull()
    .default("NORMAL"),
  status: mysqlEnum("status", [
    "ORDERED",
    "PREPARING",
    "READY",
    "SERVED",
    "CANCELLED",
  ])
    .notNull()
    .default("ORDERED"),
  printOnReceipt: tinyint("print_on_receipt").notNull().default(1),
  orderedAt: datetime("ordered_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  cancelledAt: datetime("cancelled_at"),
  cancelledByStaffId: bigint("cancelled_by_staff_id", {
    mode: "number",
    unsigned: true,
  }),
  note: varchar("note", { length: 500 }),
});

/** Existing checkout tables. A checkout is linked to its bill scope through checkout_items. */
export const paymentMethods = mysqlTable("payment_methods", {
  paymentMethodId: bigint("payment_method_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  methodCode: varchar("method_code", { length: 30 }).notNull(),
  methodName: varchar("method_name", { length: 100 }).notNull(),
  methodType: mysqlEnum("method_type", ["CASH", "CARD", "VOUCHER", "CREDIT", "TRANSFER", "OTHER"]).notNull(),
  isActive: tinyint("is_active").notNull().default(1),
  sortOrder: int("sort_order").notNull().default(0),
}, (table) => [uniqueIndex("uq_payment_method_code").on(table.methodCode)]);

export const paymentMethodSettings = mysqlTable("payment_method_settings", {
  paymentMethodId: bigint("payment_method_id", { mode: "number", unsigned: true }).primaryKey().references(() => paymentMethods.paymentMethodId),
  inputType: mysqlEnum("input_type", ["AMOUNT", "QUANTITY"]).notNull(),
  unitAmount: decimal("unit_amount", { precision: 14, scale: 2 }),
  balancePolicy: mysqlEnum("balance_policy", ["CASH_CHANGE", "FORFEIT"]),
  cashChangeEnabled: tinyint("cash_change_enabled"),
  cashChangeMinPercent: tinyint("cash_change_min_percent", { unsigned: true }),
  validityEnabled: tinyint("validity_enabled").notNull().default(0),
  validFrom: date("valid_from", { mode: "string" }),
  validUntil: date("valid_until", { mode: "string" }),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedByStaffId: bigint("updated_by_staff_id", { mode: "number", unsigned: true }).references(() => staff.staffId),
});

export const checkouts = mysqlTable("checkouts", {
  checkoutId: bigint("checkout_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  subtotalAmount: decimal("subtotal_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  discountAmount: decimal("discount_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  paidAmount: decimal("paid_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  status: mysqlEnum("status", ["OPEN", "PARTIALLY_PAID", "PAID", "CANCELLED", "REFUNDED"]).notNull().default("OPEN"),
  createdByStaffId: bigint("created_by_staff_id", { mode: "number", unsigned: true }).references(() => staff.staffId),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: datetime("completed_at"),
  note: varchar("note", { length: 500 }),
}, (table) => [index("idx_checkouts_status_time").on(table.status, table.createdAt)]);

export const checkoutItems = mysqlTable("checkout_items", {
  checkoutItemId: bigint("checkout_item_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  checkoutId: bigint("checkout_id", { mode: "number", unsigned: true }).notNull().references(() => checkouts.checkoutId),
  orderItemId: bigint("order_item_id", { mode: "number", unsigned: true }).notNull().references(() => orderItems.orderItemId),
  qty: int("qty").notNull(),
  unitPrice: decimal("unit_price", { precision: 14, scale: 2 }).notNull().default("0.00"),
  discountAmount: decimal("discount_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
}, (table) => [index("idx_checkout_items_order_item").on(table.orderItemId), index("fk_checkout_items_checkout").on(table.checkoutId)]);

export const payments = mysqlTable("payments", {
  paymentId: bigint("payment_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  checkoutId: bigint("checkout_id", { mode: "number", unsigned: true }).notNull().references(() => checkouts.checkoutId),
  paymentMethodId: bigint("payment_method_id", { mode: "number", unsigned: true }).notNull().references(() => paymentMethods.paymentMethodId),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  appliedAmount: decimal("applied_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  customerId: bigint("customer_id", { mode: "number", unsigned: true }).references(() => customers.customerId),
  customerCouponCustomerNameSnapshot: varchar("customer_coupon_customer_name_snapshot", { length: 100 }),
  customerCouponQuantity: int("customer_coupon_quantity", { unsigned: true }),
  customerCouponUnitAmountSnapshot: decimal("customer_coupon_unit_amount_snapshot", { precision: 14, scale: 2 }),
  status: mysqlEnum("status", ["PENDING", "APPROVED", "CANCELLED", "REFUNDED", "FAILED"]).notNull().default("APPROVED"),
  approvalNo: varchar("approval_no", { length: 100 }),
  externalTransactionId: varchar("external_transaction_id", { length: 150 }),
  processedByStaffId: bigint("processed_by_staff_id", { mode: "number", unsigned: true }).references(() => staff.staffId),
  paidAt: datetime("paid_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  cancelledAt: datetime("cancelled_at"),
  note: varchar("note", { length: 500 }),
}, (table) => [index("idx_payments_checkout_status").on(table.checkoutId, table.status), index("idx_payments_paid_at").on(table.paidAt), index("idx_payments_customer").on(table.customerId)]);

/** Records which physical table session received each portion of a group checkout payment. */
export const paymentSessionAllocations = mysqlTable("payment_session_allocations", {
  paymentId: bigint("payment_id", { mode: "number", unsigned: true }).notNull().references(() => payments.paymentId),
  sessionId: bigint("session_id", { mode: "number", unsigned: true }).notNull().references(() => tableSessions.sessionId),
  appliedAmount: decimal("applied_amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.paymentId, table.sessionId] }),
  index("idx_payment_session_allocations_session").on(table.sessionId),
]);

/** Signed customer trade balance history. Payment entries retain their source payment link. */
export const customerPrepaidLedger = mysqlTable("customer_prepaid_ledger", {
  ledgerId: bigint("ledger_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  customerId: bigint("customer_id", { mode: "number", unsigned: true }).notNull().references(() => customers.customerId),
  paymentId: bigint("payment_id", { mode: "number", unsigned: true }).references(() => payments.paymentId),
  entryType: mysqlEnum("entry_type", ["CARD_OVERPAYMENT", "CARD_OVERPAYMENT_REVERSAL", "PAYMENT_OVERPAYMENT", "PAYMENT_OVERPAYMENT_REVERSAL", "DEPOSIT", "REFUND", "ADJUSTMENT", "CUSTOMER_PAYMENT", "CUSTOMER_PAYMENT_REVERSAL"]).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  transactionAt: datetime("transaction_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  methodCode: varchar("method_code", { length: 20 }),
  adjustmentReason: varchar("adjustment_reason", { length: 100 }),
  memo: varchar("memo", { length: 500 }),
  requestKey: varchar("request_key", { length: 36 }),
  reversesLedgerId: bigint("reverses_ledger_id", { mode: "number", unsigned: true }).references((): AnyMySqlColumn => customerPrepaidLedger.ledgerId),
  createdByStaffId: bigint("created_by_staff_id", { mode: "number", unsigned: true }).references(() => staff.staffId),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_customer_prepaid_ledger_customer_time").on(table.customerId, table.createdAt),
  index("idx_customer_prepaid_ledger_customer_transaction").on(table.customerId, table.transactionAt, table.ledgerId),
  uniqueIndex("uq_customer_prepaid_ledger_payment_type").on(table.paymentId, table.entryType),
  uniqueIndex("uq_customer_prepaid_ledger_reversal").on(table.reversesLedgerId),
  uniqueIndex("uq_customer_prepaid_ledger_request").on(table.requestKey),
]);

export const paymentOtherDetails = mysqlTable("payment_other_details", {
  paymentId: bigint("payment_id", { mode: "number", unsigned: true }).primaryKey().references(() => payments.paymentId),
  methodNameSnapshot: varchar("method_name_snapshot", { length: 100 }).notNull(),
  inputTypeSnapshot: mysqlEnum("input_type_snapshot", ["AMOUNT", "QUANTITY"]).notNull(),
  quantity: int("quantity", { unsigned: true }),
  unitAmountSnapshot: decimal("unit_amount_snapshot", { precision: 14, scale: 2 }),
  submittedAmount: decimal("submitted_amount", { precision: 14, scale: 2 }).notNull(),
  appliedAmount: decimal("applied_amount", { precision: 14, scale: 2 }).notNull(),
  balancePolicySnapshot: mysqlEnum("balance_policy_snapshot", ["CASH_CHANGE", "FORFEIT"]),
  cashChangeEnabledSnapshot: tinyint("cash_change_enabled_snapshot"),
  cashChangeMinPercentSnapshot: tinyint("cash_change_min_percent_snapshot", { unsigned: true }),
  cashChangeAmount: decimal("cash_change_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  forfeitedAmount: decimal("forfeited_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = mysqlTable("audit_logs", {
  auditLogId: bigint("audit_log_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  staffId: bigint("staff_id", { mode: "number", unsigned: true }).references(() => staff.staffId),
  deviceId: bigint("device_id", { mode: "number", unsigned: true }),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: bigint("entity_id", { mode: "number", unsigned: true }),
  description: varchar("description", { length: 1000 }),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const orderItemCancellations = mysqlTable("order_item_cancellations", {
  cancellationId: bigint("cancellation_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  orderItemId: bigint("order_item_id", { mode: "number", unsigned: true }).notNull().references(() => orderItems.orderItemId),
  cancelledQty: int("cancelled_qty").notNull(),
  cancelledAmount: decimal("cancelled_amount", { precision: 14, scale: 2 }).notNull(),
  cancellationReason: varchar("cancellation_reason", { length: 500 }).notNull(),
  cancelledByStaffId: bigint("cancelled_by_staff_id", { mode: "number", unsigned: true }).notNull().references(() => staff.staffId),
  cancelledAt: datetime("cancelled_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_order_item_cancellations_item").on(table.orderItemId, table.cancelledAt), index("idx_order_item_cancellations_staff").on(table.cancelledByStaffId)]);

export const orderItemOptions = mysqlTable("order_item_options", {
  orderItemOptionId: bigint("order_item_option_id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  orderItemId: bigint("order_item_id", { mode: "number", unsigned: true }).notNull().references(() => orderItems.orderItemId),
  modifierOptionId: bigint("modifier_option_id", { mode: "number", unsigned: true }).references(() => modifierOptions.modifierOptionId),
  optionName: varchar("option_name", { length: 200 }).notNull(),
  qty: int("qty").notNull().default(1),
  unitPrice: decimal("unit_price", { precision: 14, scale: 2 }).notNull().default("0.00"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0.00"),
}, (table) => [index("fk_order_item_options_item").on(table.orderItemId), index("fk_order_item_options_option").on(table.modifierOptionId)]);
