-- Apply to TDK_POS_TEST first, then to TDK_POS after verification.
-- Existing links stay NULL and retain the legacy spicy-option default.
ALTER TABLE menu_modifier_groups
  ADD COLUMN pos_choice_default_option_id BIGINT UNSIGNED NULL
  AFTER sort_order;
