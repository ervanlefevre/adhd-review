// Grouping rules: ordered list of { label, pattern, weight }.
// The order of the rules is the review order; a file belongs to the first rule it matches.
// Options stores them as text, one rule per line: "Label | regex | weight".

export const OTHER_GROUP_LABEL = "Other";

export const DEFAULT_RULES_TEXT = `Docs & config | ^(doc/|CLAUDE\\.md|README|config/(?!locales/))
Migrations & schema | ^db/
Models | ^app/models/
Domain | ^app/(policies|services|workers|form_objects|validators|enumerations|synchronizers)/
Controllers & helpers | ^app/(controllers|helpers)/
Components | ^app/components/
Views & mailers | ^app/(views|mailers)/
JavaScript & assets | ^app/(javascript|assets)/
Locales (reviewed) | ^config/locales/(fr|en-gb)/
Locales (auto-translated) | ^config/locales/ | 0.1
Specs | ^spec/`;

export function parseRulesText(text) {
  const rules = [];
  const errors = [];
  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;
    // The regex itself may contain "|" (alternation): the label is everything before
    // the first "|", the weight is the last segment only when it is a number.
    const firstSeparator = line.indexOf("|");
    if (firstSeparator === -1) {
      errors.push(`line ${index + 1}: expected "Label | regex | weight"`);
      return;
    }
    const label = line.slice(0, firstSeparator).trim();
    let source = line.slice(firstSeparator + 1).trim();
    let weightText;
    const lastSeparator = source.lastIndexOf("|");
    if (lastSeparator !== -1) {
      const tail = source.slice(lastSeparator + 1).trim();
      if (tail !== "" && !Number.isNaN(Number(tail))) {
        weightText = tail;
        source = source.slice(0, lastSeparator).trim();
      }
    }
    let pattern;
    try {
      pattern = new RegExp(source);
    } catch (error) {
      errors.push(`line ${index + 1}: invalid regex (${error.message})`);
      return;
    }
    const weight = weightText === undefined || weightText === "" ? 1 : Number(weightText);
    if (Number.isNaN(weight) || weight < 0) {
      errors.push(`line ${index + 1}: weight must be a positive number`);
      return;
    }
    rules.push({ label, pattern, weight });
  });
  return { rules, errors };
}

export function defaultRules() {
  return parseRulesText(DEFAULT_RULES_TEXT).rules;
}
