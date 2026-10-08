export type RosterPromptPosition = { value: string; label: string }

/**
 * Prompt an admin pastes into an AI chat tool (together with their roster
 * file) to get JSON this app can import. The allowed positions are injected
 * live so the prompt never drifts from the configured titles.
 */
export function buildRosterAiPrompt(positions: RosterPromptPosition[]): string {
  const allowed = positions.length > 0
    ? positions.map((position) => `- "${position.value}"  (shown in the app as "${position.label}")`).join('\n')
    : '- (no positions are configured yet)'

  return `You are a careful data-conversion tool. Convert the attached committee roster (it may be an Excel sheet, CSV, PDF, image, or pasted text) into JSON. Do not summarise, interpret, or improve the data.

OUTPUT FORMAT
Return ONLY one JSON array, with no explanation before or after it. A single code block is fine. Each element must be an object with EXACTLY these four keys and no others:
{ "name": string, "student_id": string, "position": string, "contact_number": string }

FIELD RULES
- "name": the member's full name exactly as written in the source. Keep the original spelling and capitalisation. Only trim extra whitespace.
- "student_id": the student ID exactly as written (for example "DSC2404106"). Always a string. Do not change, pad, reformat, or invent IDs.
- "position": must be copied from the ALLOWED POSITIONS list below, character for character.
- "contact_number": OPTIONAL. The member's phone number exactly as written in the source (for example "012-3456789"). Keep the original formatting. If the source has no contact number for a person, use an empty string "". Never invent or guess a number. Do not copy emails or other contact types here.

ALLOWED POSITIONS (use the quoted value on the left)
${allowed}

If the source's position text clearly means one of the allowed positions (for example "Fac" meaning a facilitator title), use that allowed value. If you are not confident of the match, copy the source's original position text unchanged. Never guess and never choose a default.

GUARDRAILS - FOLLOW STRICTLY
1. Completeness: include EVERY person in the source, in the original order. Do not skip, merge, sample, or truncate rows. Do not write "..." or "and more".
2. No hallucination: use only information that is present in the source. Never invent names, IDs, or positions. Never fill gaps from memory.
3. Missing data: if a person has no student ID, position, or contact number in the source, still include them and use an empty string "" for the missing field. Never make up a value.
4. Duplicates: keep duplicated people as they appear. Do not remove or merge them.
5. Ignore anything that is not a roster member: headers, titles, page numbers, totals, notes, and empty rows. Do not output them as members.
6. Valid JSON only: double quotes, no trailing commas, no comments, no extra keys, no markdown outside the code block.
7. If the output is too long for one reply, stop at a complete row and end with the exact line CONTINUE_NEEDED outside the code block. When I say "continue", resume with the next row in a new array.

SELF-CHECK BEFORE ANSWERING
- Count the people in the source and the objects in your array. The two numbers must match.
- Every "position" is an exact allowed value or the unchanged source text.
- Every object has exactly the keys name, student_id, position, contact_number.

AFTER THE JSON, on a new line outside the code block, write: "Source people: N, JSON objects: N" with the real counts, and list any people whose student_id or position you could not confirm.

Here is the roster file/content:`
}
