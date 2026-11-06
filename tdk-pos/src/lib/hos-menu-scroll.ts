export type HosMenuSectionPosition = { categoryId: number; top: number };

export function getHosMenuCategoryAtTop(sections: HosMenuSectionPosition[], probeTop: number) {
  if (!sections.length) return null;
  const reached = sections.filter(section => section.top <= probeTop);
  return reached.at(-1)?.categoryId ?? sections[0].categoryId;
}
