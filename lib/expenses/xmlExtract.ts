/**
 * Shared XML extraction utilities used by both MyExpensesModule (canonical
 * draft-state owner) and EmployeeExpenseDetail (render layer).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExpenseDocument {
  id: number;
  filename: string;
  document_type?: string | null;
  validation_status: string;
  created_at: string;
}

export interface ExtractedData {
  uuid?:             string | null;
  total?:            string | null;
  subtotal?:         string | null;
  moneda?:           string | null;
  tipo_comprobante?: string | null;
  metodo_pago?:      string | null;
  forma_pago?:       string | null;
  fecha?:            string | null;
  emisor_rfc?:       string | null;
  emisor_nombre?:    string | null;
  receptor_rfc?:     string | null;
  receptor_nombre?:  string | null;
  descripcion?:      string | null;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse the [XML_EXTRACTED] block appended by the backend validation service
 * from a document's content_text field.  Returns undefined when no block is
 * present (e.g. PDF or ticket documents).
 */
export function parseXmlExtracted(contentText: string): ExtractedData | undefined {
  const block = contentText.match(/\[XML_EXTRACTED\]([\s\S]*?)(?:\[|$)/);
  if (!block) return undefined;
  const lines = block[1].trim().split("\n");
  const get = (key: string) => {
    const line = lines.find((l) => l.startsWith(`${key}:`));
    if (!line) return null;
    const val = line.slice(key.length + 1).trim();
    return val === "None" || val === "" ? null : val;
  };
  return {
    uuid:             get("uuid"),
    total:            get("total"),
    subtotal:         get("subtotal"),
    moneda:           get("moneda"),
    tipo_comprobante: get("tipo_comprobante"),
    metodo_pago:      get("metodo_pago"),
    forma_pago:       get("forma_pago"),
    fecha:            get("fecha"),
    emisor_rfc:       get("emisor_rfc"),
    emisor_nombre:    get("emisor_nombre"),
    receptor_rfc:     get("receptor_rfc"),
    receptor_nombre:  get("receptor_nombre"),
    descripcion:      get("descripcion"),
  };
}

// ── Document type helpers ─────────────────────────────────────────────────────

/**
 * Submission-relevant document types shown to employees.
 * Internal/accounting-only types (supporting_document, unknown) are excluded.
 */
export const SUBMISSION_TYPES = new Set([
  "cfdi_xml", "cfdi_pdf", "pdf_unclassified",
  "ticket", "receipt", "receipt_pdf",
  "justification", "proof",
]);
