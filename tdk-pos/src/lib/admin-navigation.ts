export type NavigationLink = { label: string; href: string };
export type NavigationGroup = { id: string; label: string; href: string; children: NavigationLink[] };
export type NavigationItem = NavigationLink | NavigationGroup;

const fanManagementLink: NavigationLink = { label: "선풍기관리", href: "/tdkadm/fans" };

export const adminNavigation: NavigationItem[] = [
  { label: "대시보드", href: "/tdkadm" },
  { label: "영업시간설정", href: "/tdkadm/business-hours" },
  {
    id: "sales",
    label: "판매조회",
    href: "/tdkadm/sales-report",
    children: [
      { label: "매출조회", href: "/tdkadm/sales-report" },
      { label: "품목별 매출", href: "/tdkadm/item-sales" },
      { label: "영업마감 내역", href: "/tdkadm/business-closings" },
    ],
  },
  { label: "고객 관리", href: "/tdkadm/customers" },
  {
    id: "menus",
    label: "메뉴",
    href: "/tdkadm/menus",
    children: [
      { label: "메뉴관리", href: "/tdkadm/menus" },
      { label: "메뉴분류", href: "/tdkadm/menus/categories" },
      { label: "메뉴이미지", href: "/tdkadm/menus/images" },
      { label: "메뉴설명", href: "/tdkadm/menus/descriptions" },
      { label: "추가메뉴등록", href: "/tdkadm/menus/addons" },
    ],
  },
  {
    id: "qr-settings",
    label: "QR",
    href: "/tdkadm/qr/title",
    children: [
      { label: "타이틀설정", href: "/tdkadm/qr/title" },
      { label: "안내문", href: "/tdkadm/qr/notices" },
      { label: "QR 발행·관리", href: "/tdkadm/qr-codes" },
      fanManagementLink,
        { label: "인증버튼", href: "/tdkadm/qr/auth-guide" },
    ],
  },
  {
    id: "pos-settings",
    label: "POS",
    href: "/tdkadm/settings/pos",
    children: [
      { label: "테이블 설정", href: "/tdkadm/tables" },
      { label: "할인 설정", href: "/tdkadm/settings/discounts" },
      { label: "기타결제 설정", href: "/tdkadm/settings/other-payments" },
      { label: "포장 설정", href: "/tdkadm/settings/takeout" },
      { label: "영업마감", href: "/tdkadm/settings/pos/business-closing" },
    ],
  },
  {
    id: "kds-settings",
    label: "KDS",
    href: "/tdkadm/settings/pos/kds",
    children: [{ label: "KDS 설정", href: "/tdkadm/settings/pos/kds" }],
  },
  {
    id: "hos-settings",
    label: "HOS",
    href: "/tdkadm/hos/table-layout",
    children: [{ label: "테이블 배치", href: "/tdkadm/hos/table-layout" }],
  },
  {
    id: "tdktv",
    label: "디지털 사이니지",
    href: "/tdkadm/tv",
    children: [
      { label: "TV 관리", href: "/tdkadm/tv" },
      { label: "이미지 관리", href: "/tdkadm/tv/images" },
      { label: "재생 설정", href: "/tdkadm/tv/playback" },
      { label: "안내문 관리", href: "/tdkadm/tv/notice" },
      { label: "이벤트 효과 관리", href: "/tdkadm/tv/events" },
    ],
  },
  {
    id: "printing",
    label: "인쇄 설정",
    href: "/tdkadm/settings/printing",
    children: [{ label: "매장 명판 설정", href: "/tdkadm/settings/printing/nameplate" }],
  },
  {
    id: "security",
    label: "보안",
    href: "/tdkadm/security/devices",
    children: [
      { label: "직원관리", href: "/tdkadm/security/staff" },
      { label: "API 관리", href: "/tdkadm/security/api" },
      { label: "신뢰 토큰 관리", href: "/tdkadm/security/devices" },
      { label: "최고관리자 관리", href: "/tdkadm/security/owners" },
    ],
  },
];

export function isNavigationGroup(item: NavigationItem): item is NavigationGroup {
  return "children" in item;
}

export function adminNavigationGroups() {
  return adminNavigation.filter(isNavigationGroup);
}

export function linkIsActive(pathname: string, href: string) {
  return pathname === href || (href !== "/tdkadm" && pathname.startsWith(`${href}/`));
}

export function groupContainsPath(group: NavigationGroup, pathname: string) {
  return group.children.some(child => linkIsActive(pathname, child.href))
    || pathname === group.href
    || pathname.startsWith(`${group.href}/`);
}

export function getAdminNavigationItems({
  menuOnly = false,
  canAccessSecurity = false,
  canManageHosLayout = false,
  canManageMenu = false,
}: {
  menuOnly?: boolean;
  canAccessSecurity?: boolean;
  canManageHosLayout?: boolean;
  canManageMenu?: boolean;
}): NavigationItem[] {
  if (menuOnly) {
    const menuGroup = adminNavigation.find(item => isNavigationGroup(item) && item.id === "menus");
    return canManageMenu && menuGroup ? [menuGroup] : [];
  }
  return adminNavigation.filter(item =>
    (canAccessSecurity || !isNavigationGroup(item) || item.id !== "security") &&
    (canManageHosLayout || !isNavigationGroup(item) || item.id !== "hos-settings") &&
    (canManageMenu || !isNavigationGroup(item) || item.id !== "menus") &&
    (canManageMenu || !isNavigationGroup(item) || item.id !== "qr-settings") &&
    (canManageMenu || isNavigationGroup(item) || item.href !== "/tdkadm/business-hours"))
    .map(item => {
      // Fan management and HOS layout both use the OWNER role.
      if (canManageHosLayout || !isNavigationGroup(item) || item.id !== "qr-settings") return item;
      return { ...item, children: item.children.filter(child => child !== fanManagementLink) };
    });
}
