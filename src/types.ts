export type RiskType =
  | "auto_renewal"
  | "cancellation"
  | "arbitration"
  | "class_action"
  | "fees"
  | "data_sharing";
export type Hit = {
  type: RiskType;
  start: number;
  end: number; // exclusive
  text: string;
  snippet: string;
};
export type Heatmap = {
  counts: Record<string, number>; // { third_party: 5, share: 7, affiliate: 2, ... }
  level: "Low" | "Medium" | "High";
  topRecipients: Array<{ phrase: string; count: number }>;
};
export type RulesResult = {
  hits?: Hit[];
  severity: "Low" | "Medium" | "High";
  hero?: string; // short warning line
  heatmap: Heatmap;
};
