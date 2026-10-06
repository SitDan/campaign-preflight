import { parse } from "csv-parse/sync";
import { LIMITS } from "@/config/limits";
import type { KitManifest, KitRow, ManifestRow, RowIssue } from "./types";

/**
 * Contrat CSV imposé : UTF-8 (BOM accepté), séparateur virgule,
 * en-têtes exacts, pas d'auto-détection ni de mapping. Fonction pure.
 */
export const REQUIRED_COLUMNS = ["row_id", "ad_name", "locale", "placement", "media_filename", "primary_text", "cta", "landing_url"] as const;
export const OPTIONAL_COLUMNS = ["reference_collection", "reference_offer", "reference_date", "reference_date_label"] as const;
export const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS] as const;

export type InventoryFile = { name: string; size: number };

export type ImportResult = { ok: true; manifest: KitManifest } | { ok: false; errors: string[] };

const SHORT_FIELDS = new Set(["row_id", "ad_name", "media_filename"]);

function isBasename(name: string): boolean {
  return name.length > 0 && !/[\\/]/.test(name) && !/^[a-z][a-z0-9+.-]*:/i.test(name) && name !== "." && name !== "..";
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateLandingUrl(value: string): RowIssue | null {
  if (value.length > LIMITS.urlMaxChars) return { field: "landing_url", code: "url_too_long", message: `URL de plus de ${LIMITS.urlMaxChars} caractères.` };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { field: "landing_url", code: "url_invalid", message: "URL de destination invalide." };
  }
  if (url.protocol !== "https:") return { field: "landing_url", code: "url_not_https", message: "L'URL de destination doit être en HTTPS." };
  if (url.username || url.password) return { field: "landing_url", code: "url_credentials", message: "L'URL ne doit pas contenir d'identifiants." };
  return null;
}

/** Une cellule commençant par un caractère de contrôle est refusée (contenu suspect). */
function hasControlChars(value: string): boolean {
   
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

const normalizeHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/**
 * Diagnostics déterministes des erreurs fréquentes, pour guider la correction.
 * Rien n'est corrigé automatiquement : le contrat reste strict.
 */
export function diagnoseCsv(csvText: string): string[] {
  const hints: string[] = [];
  const firstLine = csvText.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const semicolons = firstLine.split(";").length - 1;
  const commas = firstLine.split(",").length - 1;
  const tabs = firstLine.split("\t").length - 1;
  if (semicolons > commas) {
    hints.push("Séparateur « ; » détecté (export Excel en français) : réenregistrez le fichier au format « CSV UTF-8 (délimité par des virgules) ».");
  } else if (tabs > commas) {
    hints.push("Séparateur tabulation détecté : le séparateur attendu est la virgule.");
  }
  if (csvText.includes("\uFFFD") || /Ã[©¨ª«´®¯§ ]/.test(csvText)) {
    hints.push("Encodage incorrect probable (accents illisibles) : réenregistrez le fichier en UTF-8.");
  }
  const columns = firstLine.split(semicolons > commas ? ";" : tabs > commas ? "\t" : ",").map((cell) => cell.replace(/^"|"$/g, "").trim());
  for (const column of columns) {
    if ((ALL_COLUMNS as readonly string[]).includes(column)) continue;
    const match = ALL_COLUMNS.find((expected) => normalizeHeader(column) === expected || normalizeHeader(column).replace(/_/g, "") === expected.replace(/_/g, ""));
    if (match) hints.push(`Colonne « ${column.slice(0, 40)} » : le nom exact attendu est « ${match} ».`);
  }
  return hints;
}

const PARSE_ERRORS: Record<string, string> = {
  CSV_QUOTE_NOT_CLOSED: "guillemet ouvert sans guillemet fermant",
  CSV_RECORD_INCONSISTENT_FIELDS_LENGTH: "nombre de colonnes différent de l'en-tête",
  CSV_INVALID_CLOSING_QUOTE: "guillemet mal placé dans un champ",
  CSV_MAX_RECORD_SIZE: "enregistrement trop long",
};

export function parseKit(csvText: string, inventory: InventoryFile[]): ImportResult {
  const errors: string[] = [];
  if (new TextEncoder().encode(csvText).byteLength > LIMITS.csvMaxBytes) return { ok: false, errors: ["CSV de plus de 64 Kio."] };
  if (inventory.length > LIMITS.maxFilesPerKit) return { ok: false, errors: [`${inventory.length} images sélectionnées : ${LIMITS.maxFilesPerKit} maximum.`] };

  const names = inventory.map((file) => file.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) errors.push(`Plusieurs fichiers portent le même nom : ${[...new Set(duplicates)].join(", ")}.`);
  for (const name of names) {
    if (!isBasename(name) || name.length > LIMITS.shortFieldMaxChars) errors.push(`Nom de fichier invalide : ${name.slice(0, 80)}.`);
  }

  let records: string[][];
  try {
    records = parse(csvText, {
      bom: true,
      delimiter: ",",
      columns: false,
      skip_empty_lines: true,
      relax_column_count: false,
      max_record_size: LIMITS.csvMaxBytes,
    }) as string[][];
  } catch (error) {
    const { code, lines } = (error ?? {}) as { code?: string; lines?: number };
    const reason = (code && PARSE_ERRORS[code]) ?? "structure illisible";
    return { ok: false, errors: [`CSV mal formé${lines ? ` à la ligne ${lines}` : ""} : ${reason}.`, ...diagnoseCsv(csvText), ...errors] };
  }

  const header = records[0]?.map((cell) => cell.trim());
  if (!header) return { ok: false, errors: ["CSV vide.", ...errors] };
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) errors.push(`En-têtes obligatoires manquants : ${missing.join(", ")}.`, ...diagnoseCsv(csvText));
  const headerDuplicates = header.filter((name, index) => header.indexOf(name) !== index);
  if (headerDuplicates.length > 0) errors.push(`En-têtes en double : ${[...new Set(headerDuplicates)].join(", ")}.`);

  const dataRows = records.slice(1);
  if (dataRows.length === 0) errors.push("Aucune annonce dans le CSV.");
  if (dataRows.length > LIMITS.maxRowsPerKit) errors.push(`${dataRows.length} annonces : ${LIMITS.maxRowsPerKit} maximum par kit.`);

  const index = new Map(header.map((name, position) => [name, position]));
  const cell = (record: string[], column: string) => {
    const position = index.get(column);
    return position === undefined ? "" : (record[position] ?? "").trim();
  };

  const ids = dataRows.map((record) => cell(record, "row_id"));
  const duplicateIds = ids.filter((id, position) => id !== "" && ids.indexOf(id) !== position);
  if (duplicateIds.length > 0) errors.push(`row_id en double : ${[...new Set(duplicateIds)].join(", ")}.`);

  if (errors.length > 0) return { ok: false, errors };

  const unknownColumns = header.filter((name) => !(ALL_COLUMNS as readonly string[]).includes(name));
  const inventoryNames = new Set(names);
  const referenced = new Set<string>();

  const rows: ManifestRow[] = dataRows.map((record, position) => {
    const issues: RowIssue[] = [];
    const value = (column: string) => cell(record, column);
    const optional = (column: string) => value(column) || null;

    for (const column of ALL_COLUMNS) {
      const raw = value(column);
      const max = SHORT_FIELDS.has(column) ? LIMITS.shortFieldMaxChars : column === "landing_url" ? LIMITS.urlMaxChars : LIMITS.textFieldMaxChars;
      if (raw.length > max) issues.push({ field: column, code: "too_long", message: `Champ de plus de ${max} caractères.` });
      if (hasControlChars(raw)) issues.push({ field: column, code: "control_chars", message: "Caractères de contrôle interdits." });
    }
    for (const column of REQUIRED_COLUMNS) {
      if (!value(column)) issues.push({ field: column, code: "required", message: "Valeur obligatoire manquante (contrat de kit)." });
    }

    const locale = value("locale");
    if (locale && !(LIMITS.locales as readonly string[]).includes(locale)) {
      issues.push({ field: "locale", code: "out_of_scope", message: `Locale hors périmètre (${LIMITS.locales.join(", ")}).` });
    }
    const placement = value("placement");
    if (placement && placement !== LIMITS.placement) {
      issues.push({ field: "placement", code: "out_of_scope", message: "Placement hors périmètre : instagram_feed uniquement." });
    }
    const filename = value("media_filename");
    if (filename && !isBasename(filename)) {
      issues.push({ field: "media_filename", code: "not_basename", message: "Nom de fichier simple attendu (sans chemin ni URL)." });
    } else if (filename) {
      referenced.add(filename);
      if (!inventoryNames.has(filename)) issues.push({ field: "media_filename", code: "missing_file", message: "Image absente de la sélection." });
    }

    const date = optional("reference_date");
    const dateLabel = optional("reference_date_label");
    if (date && !isValidIsoDate(date)) issues.push({ field: "reference_date", code: "invalid_date", message: "Date attendue au format AAAA-MM-JJ." });
    if (date && !dateLabel) issues.push({ field: "reference_date_label", code: "required_with_date", message: "Libellé requis avec une date de référence." });

    const blocking = issues.length > 0;
    const landing = value("landing_url");
    if (landing) {
      const urlIssue = validateLandingUrl(landing);
      if (urlIssue) issues.push(urlIssue);
    }

    const row: KitRow = {
      rowId: value("row_id"),
      adName: value("ad_name"),
      locale,
      placement,
      mediaFilename: filename,
      primaryText: value("primary_text"),
      cta: value("cta"),
      landingUrl: landing,
      referenceCollection: optional("reference_collection"),
      referenceOffer: optional("reference_offer"),
      referenceDate: date,
      referenceDateLabel: dateLabel,
    };
    return { line: position + 2, row, issues, eligible: !blocking };
  });

  const warnings: string[] = [];
  if (unknownColumns.length > 0) warnings.push(`Colonnes inconnues ignorées : ${unknownColumns.join(", ")}.`);
  const excludedFiles = names.filter((name) => !referenced.has(name));
  if (excludedFiles.length > 0) warnings.push(`Images non référencées par le CSV, exclues : ${excludedFiles.join(", ")}.`);
  if (rows.some((row) => !row.row.referenceDate && row.row.referenceDateLabel)) warnings.push("Libellé de date sans date : ignoré.");

  return { ok: true, manifest: { rows, warnings, unknownColumns, excludedFiles } };
}

/** Modèle CSV fourni à l'utilisateur (colonnes facultatives incluses, vides). */
export const CSV_TEMPLATE = `${ALL_COLUMNS.join(",")}\r\n`;
