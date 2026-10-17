// What actually goes on the paper.
//
// Pure PDF builders take plain data and return bytes. The browser owns downloads.
//
// Two rules run through all of them.
//
// Paper has no colour and no tapping. A chip that is coral on a phone has to say
// what it means in words here, and anything you would have opened by tapping has
// to already be on the page. The photograph is the one exception; it is the thing
// a cook actually needs to see.
//
// Where an update date is available, sheets carry two dates: when it was printed, and when the content behind
// it last changed. A sheet in a binder is a copy of something that moved on
// without it, and the second date is how anybody finds that out.

import { type Jpeg, type SheetHeader } from "./pdf.ts";
import { plainMenuCard, plainAllergySheet, plainWordsSheet, plainGuideSheet, plainStandardSheet, plainQuizSheet, plainEmployeeSheet, plainPreshiftSheet, plainStorySheet, type StoryTopicInput, type EmployeeSheetInput } from "./plain-sheets.ts";
import type { MenuItem } from "./menu.ts";
import type { CardFieldRow } from "./card-fields.ts";
import type { CustomTerm } from "./glossary.ts";
import { contentTypeOf, CONTENT_LABELS } from "./categories.ts";

/* ---------------------------------------------------------------- shared --- */

export type SheetContext = {
  /** The restaurant's name, printed at the top of every page. */
  restaurant: string;
  /** When this was printed. Defaults to now. */
  printed?: Date;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2 Oct 2026". Short enough for a footer, unambiguous between US and EU readers. */
export function printDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** A filename somebody can still read a month later, in a folder of thirty. */
export function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "heat"
  );
}

function header(context: SheetContext, kind: string, updated?: string | Date | null): SheetHeader {
  return {
    restaurant: context.restaurant,
    kind,
    printed: printDate(context.printed ?? new Date()),
    updated: printDate(updated ?? null) || undefined,
  };
}

/** A sheet, ready to hand to the browser: what to call the file, and the bytes. */
export type PrintedSheet = { filename: string; bytes: Uint8Array };

/* ------------------------------------------------------------- dish card --- */

export type DishCardInput = {
  item: MenuItem;
  /** The photograph, already decoded. Left out if it could not be fetched. */
  photo?: Jpeg | null;
  /** The restaurant's card-field settings: which extra fields print. Left out means the fields as shipped. */
  cardFields?: readonly CardFieldRow[];
};

export function dishCard(input: DishCardInput, context: SheetContext): PrintedSheet {
  const {item, photo, cardFields} = input;
  return {
    filename: `${slug(item.name)}.pdf`,
    bytes: plainMenuCard(item, photo, header(context, `${CONTENT_LABELS[contentTypeOf(item)].short} card`, item.updated_at), cardFields),
  };
}

/** Always receives the full restaurant glossary, independent of UI search. */
export function wordsSheet(words: CustomTerm[], context: SheetContext): PrintedSheet {
  return {filename: `${slug(context.restaurant)}-all-words.pdf`, bytes: plainWordsSheet(words, header(context, 'Words'))};
}

export function guideSheet(input: {word: CustomTerm; photo?: Jpeg | null}, context: SheetContext): PrintedSheet {
  return {filename: `${slug(input.word.term)}-guide.pdf`, bytes: plainGuideSheet(input.word, input.photo, header(context, 'Guide'))};
}

/* ------------------------------------------------------------------ quiz --- */

export type QuizQuestion = {
  prompt: string;
  options: string[];
  topic?: string;
  /** Index of the right answer. Absent means the quiz has no stored answer. */
  correct?: number;
  explanation?: string;
};

export type QuizInput = {
  itemName: string;
  questions: QuizQuestion[];
  updated?: string | Date | null;
  /**
   * The trainer's copy marks the answers and prints the explanations. The blank
   * copy is the one you hand out — and it is the only one a sheet can be, if the
   * quiz has no stored answers.
   */
  answers: boolean;
};

export function quizSheet(input: QuizInput, context: SheetContext): PrintedSheet {
  const withAnswers = input.answers && input.questions.some(q => Number.isInteger(q.correct) && q.correct! >= 0 && q.correct! < q.options.length);
  const name = slug(input.itemName);
  return {
    filename: withAnswers ? `${name}-quiz-answers.pdf` : `${name}-quiz.pdf`,
    bytes: plainQuizSheet(input, withAnswers, header(context, withAnswers ? 'Quiz / trainer' : 'Quiz', input.updated)),
  };
}

export function employeeSheet(input: EmployeeSheetInput, context: SheetContext): PrintedSheet {
  return {filename: `${slug(input.name)}-training-summary.pdf`, bytes: plainEmployeeSheet(input, header(context, 'Employee summary'))};
}

/* -------------------------------------------------------------- standard --- */

export type StandardInput = {
  title: string;
  summary?: string | null;
  steps: string[];
  updated?: string | Date | null;
  section?: string | null;
};

export function standardSheet(input: StandardInput, context: SheetContext): PrintedSheet {
  return {
    filename: `${slug(input.title)}-standard.pdf`,
    bytes: plainStandardSheet(input, header(context, 'Standard', input.updated)),
  };
}

/* ------------------------------------------------------------- pre-shift --- */

export type PreshiftEntry = { name: string; status: string; detail?: string };

export type PreshiftInput = {
  serviceDate: string | Date;
  note?: string | null;
  focus: string[];
  /** Grouped the way the board groups them, so paper and screen read alike. */
  groups: { label: string; entries: PreshiftEntry[] }[];
  postedBy?: string | null;
  updated?: string | Date | null;
};

export function preshiftSheet(input: PreshiftInput, context: SheetContext): PrintedSheet {
  // Service dates are calendar dates, not UTC timestamps.
  const serviceDate = typeof input.serviceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)
    ? `${input.serviceDate}T12:00:00` : input.serviceDate;
  const date = printDate(serviceDate);
  const stamp = typeof input.serviceDate === "string"
    ? input.serviceDate.slice(0, 10)
    : input.serviceDate.toISOString().slice(0, 10);
  return {
    filename: `preshift-${stamp}.pdf`,
    bytes: plainPreshiftSheet(input, date, header(context, "Pre-shift board", input.updated)),
  };
}

/* --------------------------------------------------------------- allergy --- */

export type AllergyInput = {
  /** What was asked for, e.g. ["Shellfish"] or ["Peanut", "Sesame"]. */
  allergies: string[];
  items: MenuItem[];
  /**
   * The restaurant's own sections, in the order the library shows them. Optional:
   * without it the sheet falls back to the order the items arrive in.
   */
  sections?: readonly string[];
};

export function allergySheet(input: AllergyInput, context: SheetContext): PrintedSheet {
  const asked = input.allergies.filter(Boolean);
  const stamp = (context.printed ?? new Date()).toISOString().slice(0, 10);
  return {
    filename: `allergy-${slug(asked.join("-") || "check")}-${stamp}.pdf`,
    bytes: plainAllergySheet(input, header(context, "Allergy sheet")),
  };
}

/* ------------------------------------------------------------- our story --- */

export type StoryInput = {
  topics: StoryTopicInput[];
  /** The photograph for a single topic, already decoded. */
  photo?: Jpeg | null;
  updated?: string | Date | null;
};

/** One topic when given one, the whole story when given all of them. */
export function storySheet(input: StoryInput, context: SheetContext): PrintedSheet {
  const single = input.topics.length === 1;
  return {
    filename: single ? `${slug(input.topics[0].title)}-our-story.pdf` : `${slug(context.restaurant)}-our-story.pdf`,
    bytes: plainStorySheet({topics: input.topics, photo: input.photo}, header(context, 'Our story', input.updated)),
  };
}
