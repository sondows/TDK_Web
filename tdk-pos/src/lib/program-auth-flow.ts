/** The only source of truth for which authentication step the gate displays. */
export type AuthPhase =
  | "CHECKING"
  | "LOGIN_ID"
  | "RECOVERY_ID"
  | "SETUP_PASSWORD"
  | "LOGIN_PASSWORD"
  | "SETUP_PIN"
  | "LOGIN_PIN"
  | "AUTHENTICATED"
  | "BOOTSTRAP_SETUP"
  | "CHANGE_TEMPORARY_PASSWORD"
  | "ERROR";

export type AuthEvent =
  | { type: "TRUST_CHECKED"; trusted: boolean; pinSetupRequired: boolean;
    bootstrapAvailable: boolean }
  | { type: "RECOVERY_GRANTED" }
  | { type: "RECOVERY_ID_CONFIRMED" }
  | { type: "RECOVERY_FAILED" }
  | { type: "PASSWORD_VERIFIED"; pinSetupRequired: boolean }
  | { type: "TEMPORARY_PASSWORD_REQUIRED" }
  | { type: "TEMPORARY_PASSWORD_CHANGED" }
  | { type: "PASSWORD_REGISTERED" }
  | { type: "BOOTSTRAP_COMPLETED" }
  | { type: "PIN_AUTHENTICATED" }
  | { type: "TRUST_REQUIRED" }
  | { type: "PIN_CHANGE_REQUESTED" }
  | { type: "CHECK_FAILED" };

export type AdmIdStatus = {
  trusted: boolean;
  pinSetupRequired: boolean;
  bootstrapAvailable: boolean;
  setupHttpStatus: number;
  resetPasswordRequired?: boolean;
  state?: string;
  available?: boolean;
  passwordConfigured?: boolean | null;
};

export type AdmIdDecision = "LOGIN_PIN" | "SETUP_PIN" | "BOOTSTRAP_SETUP" | "LOGIN_PASSWORD" |
  "REGISTER_PASSWORD" | "REGISTRATION_NOT_ALLOWED" | "ACCOUNT_UNAVAILABLE" | "STATUS_UNAVAILABLE";

export function resolveAdmIdStatus(status: AdmIdStatus): AdmIdDecision {
  if (status.trusted) return status.pinSetupRequired ? "SETUP_PIN" : "LOGIN_PIN";
  if (status.bootstrapAvailable) return "BOOTSTRAP_SETUP";
  if (status.setupHttpStatus === 403) return "LOGIN_PASSWORD";
  if (status.resetPasswordRequired || (status.state === "MASTER_PASSWORD_REQUIRED" && status.available))
    return "REGISTER_PASSWORD";
  if (status.state === "MASTER_PASSWORD_SET" && status.passwordConfigured) return "LOGIN_PASSWORD";
  if (status.state === "REGISTRATION_NOT_ALLOWED") return "REGISTRATION_NOT_ALLOWED";
  if (status.state === "ACCOUNT_UNAVAILABLE") return "ACCOUNT_UNAVAILABLE";
  // In normal mode account details are withheld and the API returns resetPasswordRequired:false.
  // Trust status has already validated the employee's ADM eligibility.
  if (status.setupHttpStatus === 200 && status.resetPasswordRequired === false && !status.state)
    return "LOGIN_PASSWORD";
  return "STATUS_UNAVAILABLE";
}

export function transitionAuthPhase(current: AuthPhase, event: AuthEvent): AuthPhase {
  switch (event.type) {
    case "TRUST_CHECKED":
      if (event.trusted) return event.pinSetupRequired ? "SETUP_PIN" : "LOGIN_PIN";
      return event.bootstrapAvailable ? "BOOTSTRAP_SETUP" : "LOGIN_PASSWORD";
    case "RECOVERY_GRANTED": return "RECOVERY_ID";
    case "RECOVERY_ID_CONFIRMED": return current === "RECOVERY_ID" ? "SETUP_PASSWORD" : current;
    case "RECOVERY_FAILED":
    case "CHECK_FAILED": return "ERROR";
    case "PASSWORD_VERIFIED":
      return current === "LOGIN_PASSWORD" ?
        event.pinSetupRequired ? "SETUP_PIN" : "LOGIN_PIN" : current;
    case "TEMPORARY_PASSWORD_REQUIRED":
      return current === "LOGIN_PASSWORD" ? "CHANGE_TEMPORARY_PASSWORD" : current;
    case "TEMPORARY_PASSWORD_CHANGED":
      return current === "CHANGE_TEMPORARY_PASSWORD" ? "LOGIN_PASSWORD" : current;
    case "PASSWORD_REGISTERED":
      return current === "SETUP_PASSWORD" ? "LOGIN_PASSWORD" : current;
    case "BOOTSTRAP_COMPLETED":
      return current === "BOOTSTRAP_SETUP" ? "LOGIN_PASSWORD" : current;
    case "PIN_AUTHENTICATED":
      return current === "LOGIN_PIN" || current === "SETUP_PIN" ? "AUTHENTICATED" : current;
    case "TRUST_REQUIRED": return "LOGIN_PASSWORD";
    case "PIN_CHANGE_REQUESTED":
      return current === "LOGIN_PIN" ? "SETUP_PIN" : current;
  }
}
