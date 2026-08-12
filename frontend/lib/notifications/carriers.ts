/**
 * SMS carrier choices for the account settings carrier picker. The `value`
 * strings are a cross-side contract: they must match the backend's
 * `Carrier` choices exactly (case-sensitive), with `""` meaning "not set —
 * notify by email only".
 */
export const CARRIERS: readonly { value: string; label: string }[] = [
  { value: "", label: "Not set — email only" },
  { value: "verizon", label: "Verizon" },
  { value: "att", label: "AT&T" },
  { value: "tmobile", label: "T-Mobile" },
  { value: "sprint", label: "Sprint" },
  { value: "uscellular", label: "US Cellular" },
  { value: "boost", label: "Boost Mobile" },
  { value: "cricket", label: "Cricket Wireless" },
  { value: "metropcs", label: "Metro by T-Mobile" },
  { value: "googlefi", label: "Google Fi" },
];
