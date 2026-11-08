export type HosMenuSectionPosition = { categoryId: number; top: number };

export function getHosMenuTailSpacerHeight(sectionTop: number, viewportHeight: number, contentHeightWithoutSpacer: number) {
  if (![sectionTop, viewportHeight, contentHeightWithoutSpacer].every(Number.isFinite)) return 0;
  return Math.max(0, Math.ceil(sectionTop + viewportHeight - contentHeightWithoutSpacer));
}

export function getHosMenuCategoryAtTop(sections: HosMenuSectionPosition[], probeTop: number) {
  if (!sections.length) return null;
  const reached = sections.filter(section => section.top <= probeTop);
  return reached.at(-1)?.categoryId ?? sections[0].categoryId;
}
