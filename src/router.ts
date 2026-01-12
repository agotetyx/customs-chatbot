    export type QueryType = "passport" | "vehicle" | "name";

/**
 * Super basic:
 * - Passport: A12345678 / K99887766 etc.
 * - Vehicle: SJA1234X / SMB5566A / "JTY 223"
 * - Else: name-like search
 */
export function detectQueryType(input: string): QueryType {
  const q = input.trim();

  if (/^[A-Z]{1,2}\d{6,9}$/.test(q)) return "passport";
  if (/^[A-Z]{1,3}\s?\d{3,4}[A-Z]?$/.test(q)) return "vehicle";

  return "name";
}
