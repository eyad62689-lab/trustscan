// Bank + workshop types. Bank fields are deliberately loose (bank files are produced by
// extraction agents; unknown fields are tolerated and ignored).

export type Expr = boolean | null | undefined | { [op: string]: any };

export interface Option {
  key: string;
  label: string;
  other?: boolean;
  dontKnow?: boolean;
  condition?: Expr;
  deferred?: boolean;
  module?: string;
  desc?: string;
  hint?: string;
  [k: string]: any;
}

export interface Column {
  key: string;
  label: string;
  type: string; // text|number|single|multi|role|branch|bool
  options?: Option[];
  condition?: Expr;
  unit?: string;
  [k: string]: any;
}

export interface WhenRec { if: Expr; value: any; reason?: string; text?: string }
export interface Recommended {
  value?: any;
  reason?: string;
  when?: WhenRec[];
  text?: string;
  columnDefaults?: Record<string, any>;
  [k: string]: any;
}

export interface Part {
  key: string;
  label?: string;
  type: string;
  options?: Option[];
  max?: number | null;
  unit?: string | null;
  min?: number | null;
  maxValue?: number | null;
  columns?: Column[];
  rows?: any[];
  rowsFrom?: string | null;
  rowsFromCondition?: Expr;
  condition?: Expr;
  recommended?: Recommended | null;
  required?: boolean;
  priorities?: { key: string; label: string }[];
  defaultPriority?: string;
  deferredDefaultPriority?: string;
  [k: string]: any;
}

export interface Template {
  id: string;
  when?: Expr;
  whenText?: string;
  noRequirement?: boolean;
  text: string;
  forEachRow?: string;
  perItem?: string;
  priorityText?: string;
  priorityIf?: { if: Expr; value: string; else?: string };
  sourceTemplate?: string;
  chapter?: string;
  question?: string; // for file-level extraTemplates
  [k: string]: any;
}

export interface Question {
  id: string;
  section: string;
  order: number;
  title: string;
  help?: string;
  detail?: boolean;
  condition?: Expr;
  conditionText?: string;
  regulatory?: boolean;
  verify?: string[];
  impact?: string;
  parts: Part[];
  templates?: Template[];
  extraTemplates?: Template[];
  workshopNote?: string | null;
  alsoIn?: string[];
  reviewDate?: string;
  flagOnDontKnow?: boolean;
  chapter?: string;
  [k: string]: any;
}

export interface Opening {
  attendees?: string;
  mandatory?: string[];
  duration?: string;
  minutes?: number;
  discussion?: string[];
  notice?: string;
  notes?: string[];
}

export interface Section {
  id: string;
  title: string;
  order: number;
  condition?: Expr;
  kind?: string;
  opening?: Opening;
  contains?: { id: string }[];
  autoAdded?: boolean;
  [k: string]: any;
}

export interface Rule {
  id: string;
  scope: string;
  title?: string;
  text: string;
  applies?: Expr;
  appliesText?: string;
  regulatory?: boolean;
  verify?: string[];
  [k: string]: any;
}

export interface Conflict {
  id: string;
  scope?: string;
  title?: string;
  condition: Expr;
  action: 'flag' | 'show' | 'note' | string;
  target?: string;
  text: string;
  recommendedResolution?: any;
  [k: string]: any;
}

export interface Flag { id: string; expr: Expr; text?: string; dropped?: boolean }

export interface DeferredUnit { id: string; title: string; order?: number; [k: string]: any }

/** Normalised export.json (see export-spec.ts). */
export interface ExportSpec {
  chapterTitles: Record<string, string>;
  texts: Record<string, string>;
  regulatoryRows: RegRow[];
  verifyItems: VerifyItem[];
  setupRows: SetupRow[];
  outOfScopeLines: { when?: Expr; text: string }[];
  sectionChapters: Record<string, string>;
  privacy?: string;
  guide: { title: string; body: string }[];
  yamlKeys: Record<string, string>;
  unknownKeys: string[];
  raw: any;
}
export interface RegVariant { when?: Expr; ruling?: string; phase?: string; note?: string; outOfScope?: boolean; omit?: boolean }
export interface RegRow { id: string; item: string; ruling?: string; phase?: string; note?: string; when?: Expr; variants: RegVariant[]; outOfScope?: boolean }
export interface VerifyItem { group?: string; item: string; ref?: string; what?: string; when?: Expr }
export interface SetupRow { group?: string; n?: string | number; task: string; owner?: string; ref?: string; whenText?: string; when?: Expr }

export interface BankReportEntry { kind: string; where: string; detail: string }
export interface BankReport {
  errors: BankReportEntry[];
  warnings: BankReportEntry[];
  textConditions: BankReportEntry[];
  unresolvedLabels: BankReportEntry[];
  files: string[];
}

export interface Bank {
  version: string;
  date?: string;
  meta: any;
  flags: Flag[];
  sections: Section[];
  sectionById: Map<string, Section>;
  questions: Question[];
  questionById: Map<string, Question>;
  questionsBySection: Map<string, Question[]>;
  rules: Rule[];
  conflicts: Conflict[];
  fileTemplates: Template[];
  deferred: DeferredUnit[];
  deferredIds: Set<string>;
  exportSpec: ExportSpec;
  report: BankReport;
  scopeQid: string;
  rolesQid: string;
  branchesQid: string;
  dynamicRecipients: string[];
  singleUserLabel: string;
  multiUserFlag: string;
  priorities: { key: string; label: string }[];
  defaultPriority: string;
  reviewDate?: string;
}

// ---------------- Workshop state ----------------

export type Source = 'answer' | 'assumption' | 'free_text' | 'standard';
export type AssumptionReason =
  | 'dont_know'
  | 'unanswered'
  | 'bulk_section'
  | 'flag_recommended'
  | 'prefilled_accepted'
  | 'role_mapping'
  | 'rule';

export interface QAnswer {
  parts: Record<string, any>;
  other?: Record<string, string>; // part key (or part.optionKey for multi) -> other text
  dontKnow?: boolean;
  source: Source;
  reason?: AssumptionReason;
  touched: boolean;
  updatedAt: string;
}

export interface Attendee { id: string; role: string; name?: string }
export interface Session {
  id: string;
  start: string;
  end?: string;
  facilitator: string;
  attendees: Attendee[];
}

export type FlagStatus = 'open' | 'answered' | 'assumed';
export interface ManualFlag {
  id: string;
  qid: string;
  reason: string;
  decider?: string;
  opinions?: string;
  status: FlagStatus;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
  sessionId?: string;
}
export interface FlagResolution { status: FlagStatus; resolution: string; resolvedAt: string; value?: string }

export interface SectionNote { sessionId?: string; date: string; text: string }

export interface Workshop {
  id: string;
  entityName: string;
  createdAt: string;
  updatedAt: string;
  bankVersion: string;
  answers: Record<string, QAnswer>;
  comments: Record<string, string>;
  flags: ManualFlag[];
  autoFlagResolutions: Record<string, FlagResolution>;
  sessions: Session[];
  sectionAttendance: Record<string, string[]>;
  extraAttendees: Attendee[];
  sectionNotes: Record<string, SectionNote[]>;
  completedSections: string[];
  lastSection?: string;
  lastQuestion?: string;
  newQuestions: string[];
  importReport?: ImportReport;
  lastExportedAt?: string;
  lastChangeAt?: string;
}

export interface ImportReport {
  fromBankVersion: string;
  toBankVersion: string;
  archived: { qid: string; value: any }[];
  newQuestions: string[];
  roleMappings: { from: string; to: string }[];
  at: string;
}
