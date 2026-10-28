import type { Revision } from "./revisions.js";

export interface Version {
  effective_from: string | null;
  effective_from_basis: "unknown" | "stated" | "detected";
  effective_to: string | null;
  status: "verified" | "to_verify";
  source: string;
  last_verified: string;
  notes: string;
}
export interface FeeVersion extends Version {
  annual_fee: string | null;
  first_year_annual_fee: string | null;
  authorized_user_fee: string | null;
  foreign_transaction_fee_percent: string | null;
}
export interface EarnVersion extends Version {
  rate: string | null;
  conditions: {
    channels: ("any" | "direct" | "issuer_portal")[];
    merchants?: string[];
    region?: string;
    requires_activation?: boolean;
    prepaid?: boolean;
    online_only?: boolean;
    requires_payment?: boolean;
    minimum_transaction_amount?: string;
    selection?:
      | { type: "top_spend"; count: number; period: "billing_cycle"; categories: string[] }
      | { type: "rotating"; categories: string[]; merchants: string[] };
    time_window?: { start_days: string[]; start: string; end: string; timezone: string };
  };
  cap: {
    amount: string;
    period: "monthly" | "quarterly" | "semiannual" | "annual";
    reset_basis: "calendar" | "anniversary";
    rate_after_cap: string | null;
    shared_with?: string[];
  } | null;
}
export interface CreditVersion extends Version {
  amount: string | null;
  period: "monthly" | "quarterly" | "semiannual" | "annual" | "multi_year";
  period_years?: number;
  reset_basis:
    | "calendar"
    | "anniversary"
    | "anniversary_statement"
    | "since_last_credit"
    | "month_after_annual_fee"
    | "qualifying_activity";
  period_boundaries: "stated" | "inferred";
  cap_excludes_tax?: boolean;
  per_transaction_cap?: string;
  max_posting_lag_days: number | null;
  conditions?: {
    minimum_spend?: { amount: string; period: "transaction" | "benefit_period" | "previous_calendar_year" };
    minimum_nights?: number;
    consecutive_months?: number;
  };
}
export interface Source {
  id: string;
  url: string;
  title: string;
  accessed: string;
}
export interface Card {
  id: string;
  issuer: string;
  name: string;
  country: "US";
  currency: "USD";
  network: "amex" | "visa" | "mastercard" | "discover" | null;
  audience: "personal" | "business";
  availability: "open" | "closed_to_new" | "discontinued";
  rewards: { program: string; unit: "points" | "miles" | "cash" };
  aliases: string[];
  sources: Source[];
  notes: string;
  coverage?: {
    fees: "partial" | "reviewed";
    earn_rates: "partial" | "reviewed";
    credits: "partial" | "reviewed";
    notes: string;
  };
  fees: FeeVersion[];
  earn_rates: { id: string; category: string; versions: EarnVersion[] }[];
  credits: {
    id: string;
    name: string;
    category: string;
    family?: string;
    delivery: "statement_credit" | "issuer_wallet" | "in_app";
    enrollment: "required" | "activation" | "none" | "unknown";
    match: { keywords: string[]; exclude?: string[] };
    versions: CreditVersion[];
  }[];
}
export interface Issuer {
  id: string;
  name: string;
  domains: string[];
  automation_review: string;
}
export interface IssuerConfig {
  issuers: Issuer[];
  manual_only: string[];
  user_agent: string;
}
export interface Catalog {
  root: string;
  metadata: { schema_version: number; catalog_version: string; license: "CC0-1.0" };
  cards: Card[];
  issuers: IssuerConfig;
  revisions: Revision[];
}
