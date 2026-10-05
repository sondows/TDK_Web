const displayCodeAliases: Record<string, string> = {
  ja: "JP",
  jp: "JP",
  zh: "CN",
  cn: "CN",
};

/** Uses the primary locale subtag, with display aliases for the POS QR locale codes. */
export function toQrLanguageDisplayCode(locale: string | null | undefined): string | null {
  const language = locale?.trim().replaceAll("_", "-").split("-")[0]?.toLowerCase();
  if (!language || !/^[a-z]{2,3}$/.test(language) || language === "ko" || language === "kr") return null;
  return displayCodeAliases[language] ?? language.toUpperCase();
}
