/**
 * Metric definitions (LIFEOS-039, Feature 24).
 *
 * Every displayed metric has a visible, plain-language definition here. No
 * metric may exist only as undocumented implementation behavior — components
 * look definitions up by key and surface them in a definitions drawer. Pure data.
 */

export interface MetricDefinition {
  key: string;
  label: string;
  definition: string;
}

export const DEFINITIONS: Record<string, MetricDefinition> = {
  sessions: { key: "sessions", label: "Sessions", definition: "The count of working sessions whose start instant falls within the selected range." },
  focus_sessions: { key: "focus_sessions", label: "Focus sessions", definition: "The count of focus sessions whose start instant falls within the selected range." },
  focus_duration: { key: "focus_duration", label: "Focused duration", definition: "The sum of recorded focus-session intervals ending within the selected range. Sessions left open contribute nothing until they end." },
  session_duration: { key: "session_duration", label: "Session duration", definition: "The sum of recorded session intervals ending within the selected range. Open sessions are excluded." },
  actions_created: { key: "actions_created", label: "Actions created", definition: "Next actions whose creation instant falls within the selected range." },
  actions_completed: { key: "actions_completed", label: "Actions completed", definition: "Next actions with a 'completed' history event within the selected range." },
  captures_created: { key: "captures_created", label: "Captures created", definition: "Captures whose creation instant falls within the selected range." },
  captures_processed: { key: "captures_processed", label: "Captures processed", definition: "Captures whose processed instant falls within the selected range." },
  projects_touched: { key: "projects_touched", label: "Projects touched", definition: "Projects for which at least one linked activity event occurred during the selected range." },
  milestones_touched: { key: "milestones_touched", label: "Milestones touched", definition: "Milestones for which at least one linked activity event occurred during the selected range." },
  documents_opened: { key: "documents_opened", label: "Documents opened", definition: "Documents with a recorded last-opened instant, or a highlight/annotation created, within the selected range." },
  reading_progress: { key: "reading_progress", label: "Reading events", definition: "Highlights and annotations created within the selected range. Comprehension is never inferred." },
  beliefs_reviewed: { key: "beliefs_reviewed", label: "Beliefs reviewed", definition: "Beliefs with a recorded judgment (review) within the selected range." },
  maintenance_events: { key: "maintenance_events", label: "Maintenance events", definition: "Knowledge-maintenance decisions (reviewed, archived, merged, citation repaired, resolved…) recorded within the selected range." },
  daily_reviews: { key: "daily_reviews", label: "Daily reviews completed", definition: "Daily reviews whose completion instant falls within the selected range. A missing date is simply the absence of a review record — never a failure." },
  attention_sessions: { key: "attention_sessions", label: "Session count", definition: "The number of sessions attributed to this target within the selected range. Attention is a count of recorded activity — not a measure of value, importance, or priority." },
  last_touched: { key: "last_touched", label: "Last touched", definition: "The most recent activity event linked to this record (any type). 'Touched' means at least one linked event occurred." },
  interruptions: { key: "interruptions", label: "Interruptions logged", definition: "Interruptions manually logged during focus sessions within the selected range." },
  dormancy: { key: "dormancy", label: "No recorded activity", definition: "The record has no linked activity event within the chosen inactivity window. This is a factual absence of events, not a judgment that the record is abandoned or neglected." },
  difference: { key: "difference", label: "Difference", definition: "The raw value in the current period minus the raw value in the comparison period. Percentage difference is shown only when the previous value is non-zero." },
};

export function definition(key: string): MetricDefinition | undefined {
  return DEFINITIONS[key];
}

export function allDefinitions(): MetricDefinition[] {
  return Object.values(DEFINITIONS);
}
