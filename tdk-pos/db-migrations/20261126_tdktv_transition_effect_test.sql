-- TDK_POS_TEST only. Verify the selected database and whether the column already exists before running.
USE TDK_POS_TEST;
ALTER TABLE tv_screens
  ADD COLUMN transition_effect ENUM('NONE','FADE','SLIDE','ZOOM') NOT NULL DEFAULT 'FADE';
