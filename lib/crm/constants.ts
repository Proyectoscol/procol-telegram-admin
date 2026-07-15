// Allowed values for the CRM's free-text "enum" fields (no DB CHECK constraints,
// so these are the source of truth for the UI). Mirrors new-money-crm-code's
// src/lib/constants.ts, adapted to this project's schema.

export const ROADMAP_STAGES = ['LEAD', 'ONBOARDING', 'ACTIVE', 'AT_RISK', 'UPSELL', 'WON', 'CHURNED'] as const;
export const WIN_CONFIDENCES = ['CONFIRMED', 'LIKELY', 'UNCONFIRMED'] as const;
export const COACH_NOTE_TYPES = ['CALL', 'DM', 'OBSERVATION', 'GENERAL'] as const;
export const FOLLOWUP_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type RoadmapStage = (typeof ROADMAP_STAGES)[number];
export type WinConfidence = (typeof WIN_CONFIDENCES)[number];
export type CoachNoteType = (typeof COACH_NOTE_TYPES)[number];
export type FollowUpPriority = (typeof FOLLOWUP_PRIORITIES)[number];
