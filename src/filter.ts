/**
 * RowAsk filter planning.
 * The object sent to Laya is the question plus column names. Seed row values
 * are never copied into that object. Scores below are local match bits after
 * a filter Laya actually accepted. Abstain runs no filter and attaches no scores.
 */
import { MIN_CONFIDENCE, passed, type LayaAnswer, type LayaResult } from "./laya.ts";

export { MIN_CONFIDENCE };

export const COLUMNS = ["status", "priority", "region", "age_days", "owner"] as const;
export type Column = (typeof COLUMNS)[number];

export const SEED = [
  { id: "t1", status: "open", priority: "high", region: "north", age_days: 2, owner: "ada" },
  { id: "t2", status: "open", priority: "low", region: "south", age_days: 11, owner: "ben" },
  { id: "t3", status: "closed", priority: "high", region: "east", age_days: 30, owner: "ada" },
  { id: "t4", status: "pending", priority: "medium", region: "west", age_days: 4, owner: "chen" },
  { id: "t5", status: "open", priority: "medium", region: "north", age_days: 1, owner: "dara" },
  { id: "t6", status: "closed", priority: "low", region: "south", age_days: 20, owner: "ben" },
  { id: "t7", status: "pending", priority: "high", region: "east", age_days: 6, owner: "chen" },
  { id: "t8", status: "open", priority: "high", region: "west", age_days: 3, owner: "noor" },
] as const;

export type Row = {
  id: string;
  status: string;
  priority: string;
  region: string;
  age_days: number;
  owner: string;
};

export type ScoredRow = Row & { local_score: number; local_noul: number };

export type Filter =
  | { column: "status" | "priority" | "region" | "owner"; op: "eq" | "neq" | "contains"; value: string }
  | { column: "age_days"; op: "eq" | "neq" | "gt" | "lt"; value: number };

export function layaState(question: string): { question: string; columns: string[] } {
  return { question, columns: [...COLUMNS] };
}

export function layaQuestions() {
  return {
    column: {
      type: "choice" as const,
      instructions: "Which one column should a filter use? Pick none if the question is not a single safe filter.",
      criteria: {
        status: "ticket status",
        priority: "priority",
        region: "region",
        age_days: "age in days",
        owner: "an owner name written in the question",
        none: "no safe filter",
      },
    },
    operator: {
      type: "choice" as const,
      instructions: "Which comparison does the question ask for?",
      criteria: {
        eq: "equals",
        neq: "does not equal",
        gt: "greater than",
        lt: "less than",
        contains: "the owner text contains a token written in the question",
      },
    },
    status_value: {
      type: "choice" as const,
      instructions: "If the column is status, which status did the question name?",
      criteria: { open: "open", closed: "closed", pending: "pending", unknown: "not named" },
    },
    priority_value: {
      type: "choice" as const,
      instructions: "If the column is priority, which priority did the question name?",
      criteria: { low: "low", medium: "medium", high: "high", unknown: "not named" },
    },
    region_value: {
      type: "choice" as const,
      instructions: "If the column is region, which region did the question name?",
      criteria: { north: "north", south: "south", east: "east", west: "west", unknown: "not named" },
    },
  };
}

function choice(answers: Record<string, LayaAnswer>, key: string): string | null {
  const row = answers[key];
  if (!row || row.type !== "choice" || typeof row.choice !== "string") return null;
  if (!passed(row)) return null;
  return row.choice;
}

export function ownerToken(question: string): string | null {
  const quoted = question.match(/"([A-Za-z][A-Za-z0-9_-]{1,31})"/);
  if (quoted) return quoted[1]!.toLowerCase();
  const m = question.match(/\b(?:owner|owned by|for)\s+([A-Za-z][A-Za-z0-9_-]{1,31})\b/i);
  if (m) return m[1]!.toLowerCase();
  return null;
}

export function ageNumber(question: string): number | null {
  const m = question.match(/\b(\d{1,4})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}

export function planFilter(question: string, result: LayaResult): { filter: Filter | null; abstained: boolean; reason: string } {
  if (!result.ok) return { filter: null, abstained: true, reason: result.error };
  const column = choice(result.answers, "column");
  const operator = choice(result.answers, "operator");
  if (!column || column === "none" || !operator) {
    return { filter: null, abstained: true, reason: "abstain" };
  }
  if (column === "age_days") {
    if (operator !== "eq" && operator !== "neq" && operator !== "gt" && operator !== "lt") {
      return { filter: null, abstained: true, reason: "abstain" };
    }
    const value = ageNumber(question);
    if (value == null) return { filter: null, abstained: true, reason: "abstain" };
    return { filter: { column, op: operator, value }, abstained: false, reason: "filter" };
  }
  if (column === "owner") {
    if (operator !== "eq" && operator !== "contains") return { filter: null, abstained: true, reason: "abstain" };
    const value = ownerToken(question);
    if (!value) return { filter: null, abstained: true, reason: "abstain" };
    return { filter: { column, op: operator, value }, abstained: false, reason: "filter" };
  }
  if (column !== "status" && column !== "priority" && column !== "region") {
    return { filter: null, abstained: true, reason: "abstain" };
  }
  if (operator !== "eq" && operator !== "neq") return { filter: null, abstained: true, reason: "abstain" };
  const value = choice(result.answers, `${column}_value`);
  if (!value || value === "unknown") return { filter: null, abstained: true, reason: "abstain" };
  return { filter: { column, op: operator, value }, abstained: false, reason: "filter" };
}

export function matches(row: Row, filter: Filter): boolean {
  if (filter.column === "age_days") {
    const n = row.age_days;
    if (filter.op === "eq") return n === filter.value;
    if (filter.op === "neq") return n !== filter.value;
    if (filter.op === "gt") return n > filter.value;
    return n < filter.value;
  }
  const cell = row[filter.column].toLowerCase();
  const value = filter.value.toLowerCase();
  if (filter.op === "contains") return cell.includes(value);
  if (filter.op === "neq") return cell !== value;
  return cell === value;
}

/** Local 0/1 score and noul. Not a Laya probability. */
export function scoreRows(rows: Row[], filter: Filter): ScoredRow[] {
  return rows.map((row) => {
    const bit = matches(row, filter) ? 1 : 0;
    return { ...row, local_score: bit, local_noul: bit };
  });
}
