export const OPENING_FUND_PROMPT_DISMISSED_KEY = "tdk-pos-opening-fund-prompt-dismissed";

export function shouldPromptForOpeningFund(status: { enabled: boolean; registered: boolean }, dismissedThisLogin: boolean) {
  return status.enabled && !status.registered && !dismissedThisLogin;
}
