/**
 * Feedback-form sends per person per UTC day: owner Q67 (6 Nov 2026), 10 a day, to stop spam. A team
 * member counts on their own, not against the team (owner Q69: "feedback is per member"). Shared so
 * the API's limit and the web's "You've sent N today" message cannot drift apart.
 */
export const FEEDBACK_FORM_DAILY = 10;
