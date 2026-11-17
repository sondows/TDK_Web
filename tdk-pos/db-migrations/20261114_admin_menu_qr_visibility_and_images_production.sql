-- Apply manually to TDK_POS only after independent production schema review.
-- This file is never run automatically by deployment.
ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS is_qr_visible TINYINT NOT NULL DEFAULT 1;

-- Keep existing POS image files and rows intact while exposing the same files as QR main images.
-- This inserts references only; it does not copy or delete image files.
INSERT INTO menu_images (menu_id, image_type, image_url, sort_order, is_active, created_at)
SELECT pos.menu_id, 'QR_THUMBNAIL', pos.image_url, pos.sort_order, 1, pos.created_at
FROM menu_images AS pos
WHERE pos.image_type = 'POS'
  AND pos.is_active = 1
  AND NOT EXISTS (
    SELECT 1
    FROM menu_images AS qr
    WHERE qr.menu_id = pos.menu_id
      AND qr.image_type = 'QR_THUMBNAIL'
      AND qr.is_active = 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM menu_images AS earlier
    WHERE earlier.menu_id = pos.menu_id
      AND earlier.image_type = 'POS'
      AND earlier.is_active = 1
      AND earlier.menu_image_id < pos.menu_image_id
  );
