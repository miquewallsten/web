"use client";

import { useEffect } from "react";
import { X, CheckCircle2, FileText } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractedData?: Record<string, any> | null;
}

// ── Section definitions ───────────────────────────────────────────────────────

interface FieldDef {
  label: string;
  key: string;
  mono?: boolean;
  full?: boolean; // col-span-2
}

interface SectionDef {
  title: string;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    title: "Comprobante",
    fields: [
      { label: "Fecha",        key: "fecha" },
      { label: "Tipo",         key: "tipo_comprobante" },
      { label: "Moneda",       key: "moneda" },
      { label: "Forma pago",   key: "forma_pago" },
      { label: "Método pago",  key: "metodo_pago" },
      { label: "Serie",        key: "serie" },
      { label: "Folio",        key: "folio" },
      { label: "Lugar exp.",   key: "lugar_expedicion" },
      { label: "Exportación",  key: "exportacion" },
    ],
  },
  {
    title: "Emisor",
    fields: [
      { label: "Nombre",       key: "emisor_nombre",         full: true },
      { label: "RFC",          key: "emisor_rfc",            mono: true },
      { label: "Régimen",      key: "emisor_regimen_fiscal" },
    ],
  },
  {
    title: "Receptor",
    fields: [
      { label: "Nombre",       key: "receptor_nombre",            full: true },
      { label: "RFC",          key: "receptor_rfc",               mono: true },
      { label: "Dom. fiscal",  key: "receptor_domicilio_fiscal",  mono: true },
      { label: "Régimen",      key: "receptor_regimen_fiscal" },
      { label: "Uso CFDI",     key: "uso_cfdi" },
    ],
  },
  {
    title: "Importes",
    fields: [
      { label: "Subtotal",       key: "subtotal",                    mono: true },
      { label: "Total",          key: "total",                       mono: true },
      { label: "IVA trasladado", key: "total_impuestos_trasladados", mono: true },
      { label: "IVA retenido",   key: "total_impuestos_retenidos",   mono: true },
    ],
  },
  {
    title: "Fiscal",
    fields: [
      { label: "UUID",          key: "uuid",              mono: true, full: true },
      { label: "Impuesto",      key: "impuesto" },
      { label: "Tipo factor",   key: "tipo_factor" },
      { label: "Tasa / cuota",  key: "tasa_o_cuota",      mono: true },
      { label: "Ret. impuesto", key: "retencion_impuesto" },
      { label: "Ret. importe",  key: "retencion_importe", mono: true },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function val(data: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!data) return null;
  const v = data[key];
  if (v === null || v === undefined || String(v).trim() === "" || String(v) === "None") return null;
  return String(v);
}

function fmtAmount(v: string | null): string {
  if (!v) return "—";
  const n = parseFloat(v.replace(/,/g, ""));
  if (isNaN(n)) return v;
  return n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function XmlDetailModal({ open, onClose, extractedData }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const uuid = val(extractedData, "uuid");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawConceptos: any[] = Array.isArray(extractedData?.conceptos)
    ? extractedData!.conceptos.slice(0, 5)
    : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cfdi-title"
      >
        <div
          className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/[0.09] bg-zinc-900 shadow-[0_32px_80px_rgba(0,0,0,0.7)] ring-1 ring-inset ring-white/[0.04]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2.5">
            <div className="min-w-0">
              <h2 id="cfdi-title" className="text-[11px] font-bold uppercase tracking-widest text-white/70">
                CFDI Detail
              </h2>
              {uuid ? (
                <p className="mt-0.5 truncate font-mono text-[9px] text-white/25">{uuid}</p>
              ) : (
                <p className="mt-0.5 text-[9px] text-white/18">No UUID</p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded p-1 text-white/30 transition-colors hover:bg-white/[0.07] hover:text-white/60"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {!extractedData ? (
              /* ── Empty state ── */
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <FileText className="h-6 w-6 text-white/15" />
                <p className="text-[11px] text-white/25">No structured CFDI data available.</p>
              </div>
            ) : (
              <div className="space-y-3">

                {/* Data sections — 2-col tile grid */}
                {SECTIONS.map((section) => {
                  const hasAny = section.fields.some(({ key }) => val(extractedData, key) !== null);
                  if (!hasAny) return null;
                  return (
                    <div key={section.title}>
                      <p className="mb-1 text-[8px] font-bold uppercase tracking-widest text-white/22">
                        {section.title}
                      </p>
                      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.04]">
                        {section.fields.map(({ label, key, mono, full }) => {
                          const v = val(extractedData, key);
                          if (!v) return null;
                          return (
                            <div
                              key={key}
                              className={`bg-zinc-900/90 px-2.5 py-1.5 ${full ? "col-span-2" : ""}`}
                            >
                              <p className="text-[8px] font-semibold uppercase tracking-wider text-white/25">{label}</p>
                              <p className={`mt-0.5 break-all text-[10px] text-white/60 ${mono ? "font-mono" : ""}`}>
                                {v}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Conceptos */}
                {rawConceptos.length > 0 && (
                <div>
                  <p className="mb-1 text-[8px] font-bold uppercase tracking-widest text-white/22">
                    Conceptos ({rawConceptos.length})
                  </p>
                  <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-black/20">
                    {rawConceptos.map((c, ci) => (
                        <div
                          key={ci}
                          className={`flex items-baseline justify-between gap-3 px-2.5 py-1.5 ${
                            ci < rawConceptos.length - 1 ? "border-b border-white/[0.04]" : ""
                          }`}
                        >
                          <p className="min-w-0 flex-1 truncate text-[10px] text-white/55">
                            {c.descripcion || "—"}
                          </p>
                          <div className="flex shrink-0 items-center gap-2 text-[9px] text-white/28">
                            {c.cantidad && (
                              <span>×<span className="font-mono text-white/40"> {c.cantidad}</span></span>
                            )}
                            {c.importe && (
                              <span className="font-mono text-white/40">${fmtAmount(c.importe)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
                )}

                {/* SAT */}
                <div>
                  <p className="mb-1 text-[8px] font-bold uppercase tracking-widest text-white/22">SAT</p>
                  <div className="flex items-center justify-between gap-3 overflow-hidden rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-1.5">
                    <p className="text-[9px] text-white/22">
                      Online SAT verification requires credentials —{" "}
                      <span className="text-white/30">Settings → Integrations</span>.
                    </p>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/[0.07] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-400/60">
                      <CheckCircle2 className="h-2 w-2" /> Vigente
                    </span>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 justify-end border-t border-white/[0.07] px-4 py-2">
            <button
              onClick={onClose}
              className="rounded px-3 py-1 text-[10px] font-medium text-white/30 transition-colors hover:bg-white/[0.05] hover:text-white/50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
