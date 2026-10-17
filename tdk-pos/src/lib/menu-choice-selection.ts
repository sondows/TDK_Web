export type MenuChoiceModifier = {
  modifierGroupId: number;
  groupName: string;
  modifierOptionId: number;
  optionName: string;
  optionSortOrder: number;
  choiceDefaultOptionId: number | null;
};

export function getMenuChoice<T extends MenuChoiceModifier>(modifiers: T[]) {
  const group = modifiers.find(modifier => modifier.choiceDefaultOptionId !== null) ?? modifiers.find(modifier => modifier.groupName === "매운맛");
  const options = modifiers.filter(modifier => modifier.modifierGroupId === group?.modifierGroupId).sort((a, b) => a.optionSortOrder - b.optionSortOrder || a.modifierOptionId - b.modifierOptionId);
  const selected = options.find(option => option.modifierOptionId === group?.choiceDefaultOptionId) ?? (group?.choiceDefaultOptionId === null ? options.find(option => option.optionName === "약간매운맛") : undefined) ?? options[0];
  return { title: group?.groupName ?? "", options, selected };
}
