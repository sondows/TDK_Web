-- TDK_POS_TEST only. Preflight requires exactly the five old codes and no DP1..DP5 collision.
-- Updates existing rows only; screen_id and all image/config/group/layout data are preserved.
START TRANSACTION;
UPDATE tv_screens SET code='DP1',name='DP1' WHERE code='AD-01' AND purpose='ADVERTISEMENT';
UPDATE tv_screens SET code='DP2',name='DP2' WHERE code='MENU-01' AND purpose='MENU';
UPDATE tv_screens SET code='DP3',name='DP3' WHERE code='MENU-02' AND purpose='MENU';
UPDATE tv_screens SET code='DP4',name='DP4' WHERE code='MENU-03' AND purpose='MENU';
UPDATE tv_screens SET code='DP5',name='DP5' WHERE code='MENU-04' AND purpose='MENU';
COMMIT;
