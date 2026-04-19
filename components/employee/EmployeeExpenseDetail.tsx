"use client";

import { useEffect, useRef, useState } from "react";
import {
  FileText, Upload,
  CheckCircle2, XCircle,
  Send, Save, Trash2,
} from "lucide-react";
import {
  type ExtractedData,
  type ExpenseDocument,
  SUBMISSION_TYPES,
} from "@/lib/expenses/xmlExtract";

const API = process.env.NEXT_PUBLIC_API_BASE_URL;

// Re-export for callers that imported ExtractedData from here.
export type { ExtractedData, ExpenseDocument };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Expense {
  id: number;
  description: string;
  amount: number;
  status: string;
  detected_category: string | null;
  account_code: string | null;
  category_code: string | null;
  report_id: number | null;
  expense_date: string | null;
  created_at: string;
  project?: string | null;
  client?: string | null;
  cost_center?: string | null;
}

interface OrgUnit { id: number; name: string; code: string; }

interface AllocationRead {
  id: number;
  expense_id: number;
  project_id: number | null;
  client_id: number | null;
  cost_center_id: number | null;
  percent: number;
}

interface AllocationRow {
  project_id: number | null;
  client_id: number | null;
  cost_center_id: number | null;
  percent: string;
}

interface UploadEntry {
  localId: string;
  filename: string;
  status: "uploading" | "done" | "error";
}

interface EmployeeActions {
  can_edit: boolean;
  can_delete: boolean;
  can_submit: boolean;
  can_resubmit: boolean;
  can_add_documents: boolean;
  reasons: string[];
}

interface BlockersResult {
  expense_id: number;
  submit_blockers: string[];
  accounting_blockers: string[];
  poliza_blockers: string[];
  warnings: string[];
}

interface AllocationSummaryResult {
  expense_id: number;
  items: Array<{
    id: number;
    project_id: number | null;
    client_id: number | null;
    cost_center_id: number | null;
    percent: number;
  }>;
  presence: {
    has_any: boolean;
    has_project: boolean;
    has_client: boolean;
    has_cost_center: boolean;
    allocation_count: number;
  };
}

interface ExpensePolicy {
  id: number;
  company_id: number;
  xml_required_mode: string;
  pdf_pair_required_for_cfdi: boolean;
  international_expenses_allowed: boolean;
  tickets_allowed: boolean;
  require_justification: boolean;
  require_proof: boolean;
  allow_split_allocations: boolean;
  allocation_dimensions: string;
  manager_approval_required: boolean;
  accounting_review_required: boolean;
  ai_policy_assist_enabled: boolean;
}

interface DerivedConfig {
  enabled_modules: string[];
  allocation_dimensions: string[];
  allow_split_allocations: boolean;
  tickets_allowed: boolean;
  international_expenses_allowed: boolean;
  xml_required_mode: string;
  pdf_pair_required_for_cfdi: boolean;
  manager_flow_enabled: boolean;
  accounting_flow_enabled: boolean;
  workflow_mode: string;
}

interface Props {
  expenseId: number | null;
  expensePolicy?: ExpensePolicy | null;
  approvalSetup?: any;
  workflowSetup?: any;
  derived?: DerivedConfig | null;
  /** Canonical doc state owned by the parent (MyExpensesModule). */
  linkedDocs:  ExpenseDocument[];
  loadingDocs: boolean;
  parsedXml:   ExtractedData | null;
  satStatus:   "valid" | "warning" | "error" | null;
  /** Call after any document change to trigger parent's loadDraftDocs reload. */
  onDocRefreshNeeded: () => void;
  onDeleted?: () => void;
  onExpenseUpdated?: (expense: Expense) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const _GARBAGE: [string, string][] = [
  ["<?xml",        "Uploaded XML"],
  ["<cfdi",        "Uploaded XML"],
  ["<Comprobante", "Uploaded XML"],
  ["%PDF",         "Uploaded PDF"],
];

function sanitizeTitle(s: string): string {
  const t = s.trimStart();
  for (const [pfx, fb] of _GARBAGE) {
    if (t.startsWith(pfx)) return fb;
  }
  return s || "Untitled Expense";
}

function humanizeBlocker(msg: string): string {
  if (/xml.*(required|missing)|cfdi.*(required|missing)/i.test(msg)) return "Missing required XML (CFDI)";
  if (/pdf.*(required|missing)|paired.*pdf/i.test(msg))               return "Missing required PDF";
  if (/project.*(required|missing)/i.test(msg))                       return "Project assignment required";
  if (/client.*(required|missing)/i.test(msg))                        return "Client assignment required";
  if (/cost.?center.*(required|missing)/i.test(msg))                  return "Cost center required";
  if (/justification.*(required|missing)/i.test(msg))                 return "Justification document required";
  const clean = msg.trim().replace(/\.$/, "");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function deriveStatusLine(
  status: string,
  blockers: BlockersResult | null,
  actions: EmployeeActions | null,
): { text: string; cls: string } {
  if (blockers?.submit_blockers.length)
    return { text: humanizeBlocker(blockers.submit_blockers[0]), cls: "text-red-300/70" };
  if (blockers?.warnings.length)
    return { text: humanizeBlocker(blockers.warnings[0]), cls: "text-amber-300/60" };
  if (status === "submitted") return { text: "Waiting for review",  cls: "text-sky-300/60"     };
  if (status === "approved")  return { text: "Approved",            cls: "text-emerald-300/60" };
  if (status === "rejected")  return { text: "Rejected",            cls: "text-red-300/60"     };
  if (actions?.can_submit || actions?.can_resubmit)
    return { text: "Ready to submit", cls: "text-emerald-300/60" };
  return { text: status, cls: "text-white/30" };
}

function docTypeLabel(t: string | null | undefined): string {
  switch (t) {
    case "cfdi_xml":        return "XML";
    case "cfdi_pdf":        return "PDF";
    case "pdf":             return "PDF";
    case "pdf_unclassified":return "PDF";
    case "ticket":
    case "receipt":         return "Receipt";
    case "justification":   return "Justification";
    case "proof":           return "Proof";
    default:                return "File";
  }
}

function docTypeCls(t: string | null | undefined): string {
  switch (t) {
    case "cfdi_xml":        return "text-sky-400/70";
    case "cfdi_pdf":
    case "pdf":
    case "pdf_unclassified":return "text-indigo-400/60";
    case "ticket":
    case "receipt":         return "text-amber-400/55";
    default:                return "text-white/28";
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Btn({ children, onClick, variant = "ghost", disabled }: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "primary" | "outline" | "danger";
  disabled?: boolean;
}) {
  const cls = {
    ghost:   "text-white/35 hover:text-white/60",
    outline: "border border-white/[0.08] bg-white/[0.02] text-white/40 hover:border-white/15 hover:text-white/60",
    primary: "border border-indigo-500/25 bg-indigo-600/15 text-indigo-300 hover:bg-indigo-600/25",
    danger:  "text-red-400/50 hover:text-red-400",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}

function SelectField({ value, onChange, options, placeholder }: {
  value: number | null;
  onChange: (v: number | null) => void;
  options: OrgUnit[];
  placeholder: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-full rounded border border-white/[0.07] bg-white/[0.02] px-1.5 py-1 text-[10px] text-white/55 outline-none focus:border-indigo-500/30"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
      ))}
    </select>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function EmployeeExpenseDetail({
  expenseId, expensePolicy, derived,
  linkedDocs, loadingDocs, parsedXml, satStatus,
  onDocRefreshNeeded, onDeleted, onExpenseUpdated,
}: Props) {
  // Core data
  const [expense, setExpense] = useState<Expense | null>(null);

  // Org units
  const [projects, setProjects]       = useState<OrgUnit[]>([]);
  const [clients, setClients]         = useState<OrgUnit[]>([]);
  const [costCenters, setCostCenters] = useState<OrgUnit[]>([]);

  // Allocations
  const [allocations, setAllocations]           = useState<AllocationRead[]>([]);
  const [allocationRows, setAllocationRows]     = useState<AllocationRow[]>([
    { project_id: null, client_id: null, cost_center_id: null, percent: "100" },
  ]);
  const [savingAllocation, setSavingAllocation] = useState(false);

  // Upload
  const [uploadQueue, setUploadQueue] = useState<UploadEntry[]>([]);
  const [dragOver, setDragOver]       = useState(false);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  // Expense date editing
  const [expenseDateInput, setExpenseDateInput] = useState("");
  const [savingDate, setSavingDate]             = useState(false);

  // Loading / actions
  const [loadingExpense, setLoadingExpense] = useState(false);
  const [deletingDraft, setDeletingDraft]   = useState(false);
  const [notes, setNotes]                   = useState("");
  const [employeeActions, setEmployeeActions]     = useState<EmployeeActions | null>(null);
  const [submittingExpense, setSubmittingExpense] = useState(false);
  const [submitError, setSubmitError]             = useState<string | null>(null);
  const [expenseBlockers, setExpenseBlockers]     = useState<BlockersResult | null>(null);
  const [allocationSummary, setAllocationSummary] = useState<AllocationSummaryResult | null>(null);
  const [allocSaveError, setAllocSaveError]       = useState<string | null>(null);

  // ── Fetch org units ────────────────────────────────────────────────────────
  useEffect(() => {
    const h = { "X-User-Id": "1" };
    Promise.all([
      fetch(`${API}/expenses/projects?company_id=1`,     { headers: h }).then((r) => r.ok ? r.json() : []),
      fetch(`${API}/expenses/clients?company_id=1`,      { headers: h }).then((r) => r.ok ? r.json() : []),
      fetch(`${API}/expenses/cost-centers?company_id=1`, { headers: h }).then((r) => r.ok ? r.json() : []),
    ]).then(([p, c, cc]) => { setProjects(p); setClients(c); setCostCenters(cc); }).catch(() => {});
  }, []);

  // ── Fetch expense ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!expenseId) { setExpense(null); return; }
    setLoadingExpense(true);
    fetch(`${API}/expenses/${expenseId}`, { headers: { "X-User-Id": "1" } })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        setExpense(data);
        setExpenseDateInput(data?.expense_date ?? "");
      })
      .catch(() => setExpense(null))
      .finally(() => setLoadingExpense(false));
  }, [expenseId]);

  // ── Fetch allocations ──────────────────────────────────────────────────────
  const loadAllocations = async (id: number) => {
    const [r, sr] = await Promise.all([
      fetch(`${API}/expenses/allocations/${id}`,         { headers: { "X-User-Id": "1" } }),
      fetch(`${API}/expenses/allocations-summary/${id}`, { headers: { "X-User-Id": "1" } }),
    ]);
    if (r.ok) {
      const data: AllocationRead[] = await r.json();
      setAllocations(data);
      if (data.length > 0) {
        setAllocationRows(data.map((a) => ({
          project_id:     a.project_id,
          client_id:      a.client_id,
          cost_center_id: a.cost_center_id,
          percent:        String(a.percent),
        })));
      } else {
        setAllocationRows([{ project_id: null, client_id: null, cost_center_id: null, percent: "100" }]);
      }
    }
    if (sr.ok) setAllocationSummary(await sr.json());
  };

  useEffect(() => {
    if (!expenseId) { setAllocations([]); setAllocationSummary(null); return; }
    loadAllocations(expenseId);
  }, [expenseId]);

  // ── Fetch employee actions ─────────────────────────────────────────────────
  useEffect(() => {
    if (!expenseId) { setEmployeeActions(null); return; }
    fetch(`${API}/expenses/actions/${expenseId}?portal_role=employee`, { headers: { "X-User-Id": "1" } })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setEmployeeActions(data?.actions ?? null))
      .catch(() => setEmployeeActions(null));
  }, [expenseId, expense?.status]);

  // ── Fetch submission blockers ──────────────────────────────────────────────
  useEffect(() => {
    if (!expenseId) { setExpenseBlockers(null); return; }
    fetch(`${API}/expenses/blockers/${expenseId}`, { headers: { "X-User-Id": "1" } })
      .then((r) => r.ok ? r.json() : null)
      .then(setExpenseBlockers)
      .catch(() => setExpenseBlockers(null));
  }, [expenseId, expense?.status]);

  // ── Save expense date ──────────────────────────────────────────────────────
  const saveExpenseDate = async () => {
    if (!expense || !expenseDateInput) return;
    setSavingDate(true);
    try {
      const r = await fetch(`${API}/expenses/${expense.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-User-Id": "1" },
        body: JSON.stringify({ expense_date: expenseDateInput }),
      });
      if (r.ok) {
        const updated = await r.json();
        setExpense(updated);
        onExpenseUpdated?.(updated);
      }
    } finally {
      setSavingDate(false);
    }
  };

  // ── Upload documents ───────────────────────────────────────────────────────
  const uploadDocuments = async (files: FileList | File[]) => {
    if (!expenseId) return;
    const arr = Array.from(files);
    if (!arr.length) return;

    const entries: UploadEntry[] = arr.map((f) => ({
      localId:  `${Date.now()}-${f.name}`,
      filename: f.name,
      status:   "uploading",
    }));
    setUploadQueue((prev) => [...prev, ...entries]);

    await Promise.allSettled(
      arr.map(async (file, i) => {
        const localId = entries[i].localId;
        try {
          const content = await file.text().catch(() => "");
          const r = await fetch(`${API}/expenses/documents`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-User-Id": "1" },
            body: JSON.stringify({
              company_id:   1,
              expense_id:   expenseId,
              filename:     file.name,
              content_text: content,
            }),
          });
          if (!r.ok) {
            setUploadQueue((prev) =>
              prev.map((e) => e.localId === localId ? { ...e, status: "error" } : e)
            );
            return;
          }
          const doc = await r.json() as { id?: number; document_type?: string | null };
          setUploadQueue((prev) =>
            prev.map((e) => e.localId === localId ? { ...e, status: "done" } : e)
          );
          void doc; // backend has enriched the expense; re-fetch happens below
        } catch {
          setUploadQueue((prev) =>
            prev.map((e) => e.localId === localId ? { ...e, status: "error" } : e)
          );
        }
      }),
    );

    // Notify parent to reload docs + re-fetch expense (picks up backend enrichment).
    onDocRefreshNeeded();

    // Re-fetch expense locally to sync date/amount/description into the form.
    const er = await fetch(`${API}/expenses/${expenseId}`, { headers: { "X-User-Id": "1" } });
    if (er.ok) {
      const updated: Expense = await er.json();
      setExpense(updated);
      setExpenseDateInput(updated.expense_date ?? "");
      onExpenseUpdated?.(updated);
    }

    const br = await fetch(`${API}/expenses/blockers/${expenseId}`, { headers: { "X-User-Id": "1" } });
    if (br.ok) setExpenseBlockers(await br.json());

    // Clear done entries after a short delay
    setTimeout(() => {
      setUploadQueue((prev) => prev.filter((e) => e.status !== "done"));
    }, 1500);
  };

  // ── Save allocations ───────────────────────────────────────────────────────
  const saveAllocations = async () => {
    if (!expenseId) return;
    setSavingAllocation(true);
    setAllocSaveError(null);
    try {
      const rows = allowSplit ? allocationRows : allocationRows.slice(0, 1);
      const items = rows
        .filter((row) => row.project_id || row.client_id || row.cost_center_id)
        .map((row) => ({
          project_id:     row.project_id,
          client_id:      row.client_id,
          cost_center_id: row.cost_center_id,
          percent:        parseFloat(row.percent) || 100,
        }));

      if (items.length === 0) {
        setAllocSaveError("Select at least one allocation dimension before saving.");
        return;
      }

      const r = await fetch(`${API}/expenses/allocation-edit/${expenseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-User-Id": "1" },
        body: JSON.stringify({ items }),
      });

      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setAllocSaveError(body?.detail ?? `Save failed (${r.status}).`);
        return;
      }

      await loadAllocations(expenseId);
      const [br, ar] = await Promise.all([
        fetch(`${API}/expenses/blockers/${expenseId}`, { headers: { "X-User-Id": "1" } }),
        fetch(`${API}/expenses/actions/${expenseId}?portal_role=employee`, { headers: { "X-User-Id": "1" } }),
      ]);
      if (br.ok) setExpenseBlockers(await br.json());
      if (ar.ok) { const ad = await ar.json(); setEmployeeActions(ad?.actions ?? null); }
    } finally {
      setSavingAllocation(false);
    }
  };

  const updateRow = (i: number, field: keyof AllocationRow, value: number | null | string) =>
    setAllocationRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  // ── Delete draft ───────────────────────────────────────────────────────────
  const deleteDraft = async () => {
    if (!expense) return;
    if (!window.confirm("Delete this expense?")) return;
    setDeletingDraft(true);
    try {
      const r = await fetch(`${API}/expenses/${expense.id}`, {
        method: "DELETE", headers: { "X-User-Id": "1" },
      });
      if (r.ok) onDeleted?.();
    } catch { /* silent */ } finally {
      setDeletingDraft(false);
    }
  };

  // ── Submit / resubmit ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!expense) return;
    setSubmittingExpense(true);
    setSubmitError(null);
    try {
      const r = await fetch(
        `${API}/expenses/review-actions/${expense.id}/submit`,
        { method: "POST", headers: { "X-User-Id": "1" } },
      );
      if (r.ok) {
        const updated = await r.json();
        setExpense(updated);
        onExpenseUpdated?.(updated);
        const ar = await fetch(
          `${API}/expenses/actions/${expense.id}?portal_role=employee`,
          { headers: { "X-User-Id": "1" } },
        );
        if (ar.ok) { const ad = await ar.json(); setEmployeeActions(ad?.actions ?? null); }
      } else {
        const body = await r.json().catch(() => ({}));
        setSubmitError(body?.detail ?? `Submission failed (${r.status}).`);
      }
    } catch {
      setSubmitError("Could not reach the server.");
    } finally {
      setSubmittingExpense(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const splitTotal  = allocationRows.reduce((s, r) => s + (parseFloat(r.percent) || 0), 0);
  const firstAlloc  = allocations[0];
  const projectName = firstAlloc?.project_id     ? projects.find((p)    => p.id === firstAlloc.project_id)?.name     ?? null : null;
  const clientName  = firstAlloc?.client_id      ? clients.find((c)     => c.id === firstAlloc.client_id)?.name      ?? null : null;
  const ccName      = firstAlloc?.cost_center_id ? costCenters.find((c) => c.id === firstAlloc.cost_center_id)?.name ?? null : null;

  const allowSplit      = derived?.allow_split_allocations ?? expensePolicy?.allow_split_allocations ?? false;
  const pdfPairRequired = derived?.pdf_pair_required_for_cfdi ?? expensePolicy?.pdf_pair_required_for_cfdi ?? false;
  const xmlMode         = derived?.xml_required_mode ?? expensePolicy?.xml_required_mode ?? "optional";

  const dimStr      = expensePolicy?.allocation_dimensions ?? "";
  const showProject = dimStr.includes("project");
  const showClient  = dimStr.includes("client");
  const showCC      = dimStr.includes("cost_center");

  const activeDims: Array<{ key: "project_id" | "client_id" | "cost_center_id"; label: string; units: OrgUnit[]; ph: string }> = [];
  if (showProject) activeDims.push({ key: "project_id",     label: "Project",     units: projects,    ph: "Project" });
  if (showClient)  activeDims.push({ key: "client_id",      label: "Client",      units: clients,     ph: "Client"  });
  if (showCC)      activeDims.push({ key: "cost_center_id", label: "Cost Center", units: costCenters, ph: "CC"      });
  const xmlRequired    = xmlMode === "always" || (xmlMode === "mxn_only" && expense !== null && expense.amount > 0);
  const requireProof   = expensePolicy?.require_proof ?? false;
  const requireJust    = expensePolicy?.require_justification ?? false;

  // Submission-only docs — filter out accounting-internal types
  const submissionDocs = linkedDocs.filter(
    (d) => !d.document_type || SUBMISSION_TYPES.has(d.document_type),
  );
  const hasXml  = submissionDocs.some((d) => d.document_type === "cfdi_xml");
  const hasPdf  = submissionDocs.some((d) =>
    ["cfdi_pdf", "pdf", "pdf_unclassified"].includes(d.document_type ?? ""),
  );
  const hasProof = submissionDocs.some((d) => d.document_type === "proof");
  const hasJust  = submissionDocs.some((d) => d.document_type === "justification");

  // One next action — first missing required document, as a plain sentence.
  const nextAction: string | null = (() => {
    if (xmlRequired && !hasXml)               return "Upload the CFDI XML to continue.";
    if (pdfPairRequired && hasXml && !hasPdf) return "Upload the paired PDF.";
    if (requireProof && !hasProof)            return "Proof of expense required.";
    if (requireJust && !hasJust)              return "Justification document required.";
    return null;
  })();

  // ── Empty states ───────────────────────────────────────────────────────────
  if (!expenseId || (!loadingExpense && !expense)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03]">
          <FileText className="h-5 w-5 text-white/15" />
        </div>
        <div>
          <p className="text-sm font-medium text-white/25">Select an expense</p>
          <p className="mt-0.5 text-xs text-white/15">Choose an item from the list to review details.</p>
        </div>
      </div>
    );
  }

  if (loadingExpense || !expense) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-white/20">Loading…</p>
      </div>
    );
  }

  const canUpload  = !employeeActions || employeeActions.can_add_documents;
  const statusLine = deriveStatusLine(expense.status, expenseBlockers, employeeActions);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-10">

      {/* ── Summary card ──────────────────────────────────────────────── */}
      <div className="px-0.5 pt-1">
        {/* Title + amount */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13px] font-semibold leading-snug text-white">
              {sanitizeTitle(expense.description)}
            </h2>
            {/* Expense date — primary */}
            {employeeActions?.can_edit !== false ? (
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  type="date"
                  value={expenseDateInput}
                  onChange={(e) => setExpenseDateInput(e.target.value)}
                  onBlur={saveExpenseDate}
                  className="bg-transparent text-[10px] text-white/40 outline-none [color-scheme:dark]"
                />
                {savingDate && <span className="text-[9px] text-white/22">saving…</span>}
                {!expenseDateInput && (
                  <span className="text-[9px] text-amber-300/45">Set expense date</span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-[10px] text-white/45">
                {expense.expense_date
                  ? new Date(expense.expense_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : <span className="text-white/22 italic">No date set</span>}
              </p>
            )}
            {/* Submitted/created — secondary metadata */}
            <p className="mt-0.5 text-[9px] text-white/18">
              #{expense.id} · created {new Date(expense.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums leading-none text-white">${expense.amount.toFixed(2)}</p>
            <p className="mt-0.5 text-[9px] text-white/20">MXN</p>
          </div>
        </div>

        {/* Status line + actions */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className={`text-[10px] ${statusLine.cls}`}>{statusLine.text}</p>
          <div className="flex items-center gap-1.5">
            {(employeeActions?.can_submit || employeeActions?.can_resubmit) && (
              <Btn variant="primary" onClick={handleSubmit} disabled={submittingExpense}>
                <Send className="h-3 w-3" />
                {submittingExpense ? "Submitting…" : employeeActions?.can_resubmit ? "Resubmit" : "Submit"}
              </Btn>
            )}
          </div>
        </div>

        {/* Secondary: delete draft — dimmed text link, not in the primary action row */}
        {employeeActions?.can_delete && (
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={deleteDraft}
              disabled={deletingDraft}
              className="flex items-center gap-1 text-[9px] text-white/18 transition-colors hover:text-red-400/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-2.5 w-2.5" />
              {deletingDraft ? "Deleting…" : "Delete draft"}
            </button>
          </div>
        )}

        {/* Submission error */}
        {submitError && (
          <p className="mt-1.5 text-[10px] text-red-300/60">{submitError}</p>
        )}
      </div>

      {/* ── Documents ─────────────────────────────────────────────────── */}
      <div>

        {/* Header */}
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] text-white/35">Documents</span>
          {submissionDocs.length > 0 && (
            <span className="text-[10px] text-white/20">{submissionDocs.length}</span>
          )}
        </div>

        {/* Upload zone — compact single-line */}
        {canUpload && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload files"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) uploadDocuments(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed py-3.5 transition-colors select-none
              ${dragOver
                ? "border-indigo-500/50 bg-indigo-500/[0.06]"
                : "border-white/[0.09] hover:border-white/[0.18] hover:bg-white/[0.015]"}`}
          >
            <Upload className={`h-3.5 w-3.5 shrink-0 transition-colors ${dragOver ? "text-indigo-400/70" : "text-white/20"}`} />
            <p className="text-[10px] text-white/28">
              Drag here or{" "}
              <span className={`transition-colors ${dragOver ? "text-indigo-400/70" : "text-indigo-400/45"}`}>
                browse
              </span>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xml,.pdf,application/xml,application/pdf,text/xml"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  uploadDocuments(e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </div>
        )}

        {/* Upload progress — one row per file, no status text */}
        {uploadQueue.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {uploadQueue.map((entry) => (
              <div key={entry.localId} className="flex items-center gap-1.5">
                {entry.status === "uploading" && (
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-indigo-400/60" />
                )}
                {entry.status === "done" && (
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400/55" />
                )}
                {entry.status === "error" && (
                  <XCircle className="h-3 w-3 shrink-0 text-red-400/50" />
                )}
                <span className={`min-w-0 flex-1 truncate text-[9px] ${
                  entry.status === "error" ? "text-red-300/50" : "text-white/30"
                }`}>{entry.filename}</span>
                {entry.status === "error" && (
                  <span className="shrink-0 text-[9px] text-red-400/40">failed</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Loading state */}
        {loadingDocs && submissionDocs.length === 0 && (
          <p className="mt-2 text-[10px] text-white/20">Loading…</p>
        )}

        {/* Uploaded files — compact, no icon */}
        {submissionDocs.length > 0 && (
          <div className="mt-2 divide-y divide-white/[0.04]">
            {submissionDocs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-1.5 py-1">
                <span className="min-w-0 flex-1 truncate text-[10px] text-white/40">{doc.filename}</span>
                <span className={`shrink-0 text-[9px] ${docTypeCls(doc.document_type)}`}>
                  {docTypeLabel(doc.document_type)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* XML parse result strip */}
        {parsedXml && (
          <div className="mt-2 rounded border border-white/[0.05] bg-white/[0.015] px-2.5 py-1.5">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-sky-400/50">XML</span>
              {satStatus === "valid"   && <span className="text-[9px] text-emerald-400/55">SAT ✓</span>}
              {satStatus === "warning" && <span className="text-[9px] text-amber-400/50">SAT warning</span>}
              {satStatus === "error"   && <span className="text-[9px] text-red-400/45">SAT failed</span>}
            </div>
            <div className="space-y-0.5">
              {parsedXml.emisor_nombre && (
                <div className="flex items-baseline gap-1.5">
                  <span className="w-10 shrink-0 text-[9px] text-white/20">Vendor</span>
                  <span className="min-w-0 truncate text-[9px] text-white/50">{parsedXml.emisor_nombre}</span>
                </div>
              )}
              {(parsedXml.total || parsedXml.fecha) && (
                <div className="flex gap-4">
                  {parsedXml.total && (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[9px] text-white/20">Total</span>
                      <span className="font-mono text-[9px] text-white/45">{parsedXml.total}{parsedXml.moneda ? ` ${parsedXml.moneda}` : ""}</span>
                    </div>
                  )}
                  {parsedXml.fecha && (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[9px] text-white/20">Date</span>
                      <span className="text-[9px] text-white/45">{parsedXml.fecha.substring(0, 10)}</span>
                    </div>
                  )}
                </div>
              )}
              {parsedXml.uuid && (
                <p className="truncate font-mono text-[8px] text-white/18">UUID {parsedXml.uuid}</p>
              )}
            </div>
          </div>
        )}

        {/* Status indicators + one next action */}
        {!uploadQueue.some((e) => e.status === "uploading") &&
          (submissionDocs.length > 0 || nextAction !== null) && (
          <div className="mt-2 flex items-center gap-2.5">
            {xmlRequired && (
              hasXml
                ? <span className="text-[9px] text-emerald-300/40">✓ XML</span>
                : <span className="text-[9px] text-white/20">· XML</span>
            )}
            {pdfPairRequired && (
              hasPdf
                ? <span className="text-[9px] text-emerald-300/40">✓ PDF</span>
                : hasXml
                  ? <span className="text-[9px] text-amber-300/50">PDF needed</span>
                  : <span className="text-[9px] text-white/20">· PDF</span>
            )}
            {nextAction && (
              <span className="ml-auto text-right text-[9px] text-amber-300/45">{nextAction}</span>
            )}
          </div>
        )}
      </div>

      {/* ── Allocation ────────────────────────────────────────────────── */}
      {activeDims.length > 0 && (() => {
        const readOnly = employeeActions?.can_edit === false;
        const needsAssignment = expenseBlockers
          ? [...expenseBlockers.submit_blockers, ...expenseBlockers.accounting_blockers]
              .some((b) => /project.+required|client.+required|cost.?center.+required/i.test(b))
          : false;

        return (
          <div className="space-y-2 px-0.5">

            {/* One row per dimension */}
            {activeDims.map(({ key, label, units, ph }) => {
              const currentVal = allocationRows[0]?.[key] ?? null;
              const savedName  = key === "project_id" ? projectName : key === "client_id" ? clientName : ccName;
              return readOnly ? (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-[10px] text-white/28">{label}</span>
                  <span className="text-[10px] text-white/50">{savedName ?? "—"}</span>
                </div>
              ) : (
                <div key={key} className="flex items-center gap-2">
                  {activeDims.length > 1 && (
                    <span className="w-16 shrink-0 text-[10px] text-white/28">{label}</span>
                  )}
                  <div className="flex-1">
                    <SelectField value={currentVal} onChange={(v) => updateRow(0, key, v)} options={units} placeholder={ph} />
                  </div>
                </div>
              );
            })}

            {/* Extra split rows */}
            {allowSplit && allocationRows.slice(1).map((row, idx) => {
              const i = idx + 1;
              return (
                <div key={i} className="flex items-center gap-1">
                  {activeDims.map((d) => (
                    <div key={d.key} className="flex-1">
                      <SelectField value={row[d.key]} onChange={(v) => updateRow(i, d.key, v)} options={d.units} placeholder={d.ph} />
                    </div>
                  ))}
                  <input
                    type="number" min="0" max="100" value={row.percent}
                    onChange={(e) => updateRow(i, "percent", e.target.value)}
                    className="w-12 rounded border border-white/[0.08] bg-zinc-900 px-1 py-0.5 text-[10px] text-white/55 outline-none focus:border-indigo-500/40"
                  />
                  <span className="text-[9px] text-white/22">%</span>
                </div>
              );
            })}

            {/* Required hint */}
            {needsAssignment && (
              <p className="text-[9px] text-amber-300/50">Assignment required before submitting.</p>
            )}

            {/* Actions */}
            {!readOnly && (
              <div className="flex items-center justify-between pt-0.5">
                <div className="flex items-center gap-2">
                  {allowSplit && (
                    <button
                      type="button"
                      onClick={() => setAllocationRows((p) => [...p, { project_id: null, client_id: null, cost_center_id: null, percent: "0" }])}
                      className="text-[9px] text-white/28 transition-colors hover:text-white/50"
                    >
                      + Add split
                    </button>
                  )}
                  {allowSplit && allocationRows.length > 1 && (
                    <span className={`text-[9px] font-bold tabular-nums ${splitTotal === 100 ? "text-emerald-400/70" : "text-amber-400/70"}`}>
                      {splitTotal.toFixed(0)}%
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {allocSaveError && <span className="text-[9px] text-red-300/60">{allocSaveError}</span>}
                  <Btn variant="primary" onClick={saveAllocations} disabled={savingAllocation}>
                    <Save className="h-3 w-3" /> {savingAllocation ? "Saving…" : "Save"}
                  </Btn>
                </div>
              </div>
            )}

          </div>
        );
      })()}

      {/* ── Notes ─────────────────────────────────────────────────────── */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        readOnly={employeeActions?.can_edit === false}
        rows={3}
        placeholder="Notes for approvers…"
        className={`w-full resize-none rounded border border-white/[0.06] px-2.5 py-2 text-[10px] placeholder-white/15 outline-none transition-colors ${employeeActions?.can_edit === false ? "cursor-not-allowed bg-transparent text-white/25" : "bg-white/[0.02] text-white/50 focus:border-white/[0.12]"}`}
      />

    </div>
  );
}
