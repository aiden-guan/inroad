"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { FIELDS, PRESETS } from "@/lib/network/presets";
import type { previewMappedImport } from "@/lib/automation/imports";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { controlClass, type AutomationController } from "./use-automation";

export function ImportMapper({ data, name, automation }: { data: unknown; name: string; automation: AutomationController }) {
  const { refresh } = useWorkspace();
  const [path, setPath] = useState(Array.isArray(data) ? "" : "results");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [label, setLabel] = useState(name);
  const [preset, setPreset] = useState("generic");
  const [remember, setRemember] = useState(true);
  const [preview, setPreview] = useState<ReturnType<typeof previewMappedImport> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function suggest() {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const result = await automation.run<{ fields: Record<string, string> }>({ action: "suggest_mapping", data, resultPath: path });
      setFields(result.fields);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn't map those records.");
    } finally {
      setBusy(false);
    }
  }
  async function run(commit = false) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const input = { data, name: label, resultPath: path, fields, preset, remember, ...(commit && preview ? { previewToken: preview.previewToken } : {}) };
      if (commit) {
        await automation.run({ action: "import", input });
        await refresh();
        setPreview(null);
        setMessage("Records imported. Existing fields and opt-outs were respected. You can undo this import from Integrations → CSV imports.");
      } else setPreview(await automation.run({ action: "preview_import", input }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "The import didn't finish.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-5 space-y-4 rounded-lg border border-border p-4">
      <h3 className="text-[15px] font-medium">Map and preview records</h3>
      <p className="text-[12px] leading-5 text-fg-3">
        Preview five records before importing. Fields use paths such as company.domain or person.email. A work email can identify the company.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12px] text-fg-2">
          Mapping name
          <Input aria-label="Mapping name" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="text-[12px] text-fg-2">
          Records path
          <Input
            aria-label="Records path"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              setPreview(null);
            }}
            placeholder="data.records, results, or blank for a list"
          />
        </label>
        <label className="text-[12px] text-fg-2">
          List type
          <select
            aria-label="List type"
            className={controlClass}
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              setPreview(null);
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-fg-2">
          Saved mapping
          <select
            aria-label="Saved mapping"
            className={controlClass}
            defaultValue=""
            onChange={(e) => {
              const saved = automation.data?.imports.find((p) => p.id === e.target.value);
              if (saved) {
                setFields(saved.fields);
                setPath(saved.resultPath);
                setLabel(saved.name);
                setPreview(null);
              }
            }}
          >
            <option value="">Choose a previous mapping</option>
            {automation.data?.imports.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void suggest()}>
        Suggest field mapping
      </Button>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-[12px] text-fg-2">
            {f.label}
            <Input
              aria-label={`Map ${f.label}`}
              value={fields[f.key] ?? ""}
              onChange={(e) => {
                setFields({ ...fields, [f.key]: e.target.value });
                setPreview(null);
              }}
              placeholder="Leave blank to skip"
            />
          </label>
        ))}
      </div>
      <label className="block text-[12px] text-fg-2">
        Source opt-out field (optional)
        <Input
          aria-label="Map opt-out field"
          value={fields.optOut ?? ""}
          onChange={(e) => {
            setFields({ ...fields, optOut: e.target.value });
            setPreview(null);
          }}
          placeholder="unsubscribed or contact.do_not_contact"
        />
      </label>
      <label className="flex items-center gap-2 text-[12px] text-fg-2">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember this mapping for the next import
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void run()}>
          Preview import
        </Button>
        {preview && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || (!preview.newAccounts && !preview.existingAccounts && !preview.newPeople)}
            onClick={() => void run(true)}
          >
            Import previewed records
          </Button>
        )}
      </div>
      {preview && (
        <div className="space-y-2 text-[12px] text-fg-2">
          <p role="status">
            {preview.newAccounts} new companies · {preview.existingAccounts} already saved · {preview.newPeople} new people · {preview.skipped.length} skipped
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg-subtle p-3 text-[11px]">{JSON.stringify(preview.sample, null, 2)}</pre>
          {preview.skipped.length > 0 && (
            <details>
              <summary>Skipped rows and reasons</summary>
              <pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(preview.skipped.slice(0, 20), null, 2)}</pre>
            </details>
          )}
        </div>
      )}
      {error && <FieldError>{error}</FieldError>}
      {message && (
        <p role="status" className="text-[12px] text-fg-2">
          {message}
        </p>
      )}
    </section>
  );
}
