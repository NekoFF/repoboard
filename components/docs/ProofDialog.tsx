"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, FileText, ImagePlus, Link2, Quote, X } from "lucide-react";
import type { DocEdit, Proof } from "@/lib/markdown/document";
import type { ItemState } from "@/lib/markdown/format";
import { api, useResource } from "@/lib/client/api";
import { useShell } from "@/components/shell/ShellContext";
import { Modal, Spinner, useToast } from "@/components/ui";

export interface ProofAttachment {
  /** Where it will live in the repository. */
  path: string;
  base64: string;
  /** A local preview of the picture. */
  url: string;
}

export interface ProofDraft {
  edit: Extract<DocEdit, { type: "proof" }>;
  attachments: ProofAttachment[];
}

const EVIDENCE_DIR = ".repoboard/evidence";

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 40)
    .replace(/-+$/, "") || "item";

/** `to` written relative to the folder `from` is in, so the link works on GitHub too. */
function relativePath(from: string, to: string): string {
  const base = from.split("/").slice(0, -1);
  const target = to.split("/");
  let common = 0;
  while (common < base.length && base[common] === target[common]) common += 1;
  return [...base.slice(common).map(() => ".."), ...target.slice(common)].join("/") || to;
}

/** A screenshot, made small enough to commit: at most 1600 px wide, WebP where the browser can. */
async function prepareImage(file: Blob): Promise<{ base64: string; ext: string; url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
  if (!blob || blob.type !== "image/webp") blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not read the picture");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob!);
  });
  return { base64: dataUrl.split(",")[1] ?? "", ext: blob.type === "image/webp" ? "webp" : "png", url: URL.createObjectURL(blob) };
}

/**
 * Done, and here is why: where it is written (a file and its lines, or a
 * link), the words themselves, a screenshot — any of them, or none. The
 * proof is written under the item with who checked it and when, and a file
 * reference becomes a permalink to the exact version that was checked.
 */
export function ProofDialog({
  docPath,
  item,
  state = "done",
  onClose,
  onDone,
}: {
  docPath: string;
  item: { line: number; text: string; title: string; id: string | null };
  state?: ItemState;
  onClose: () => void;
  onDone: (draft: ProofDraft) => void;
}) {
  const toast = useToast();
  const { viewer, connected } = useShell();
  const files = useResource(api.repoFiles, [], { enabled: connected });
  const [where, setWhere] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quote, setQuote] = useState("");
  const [shots, setShots] = useState<{ base64: string; ext: string; url: string; alt: string }[]>([]);
  const [reading, setReading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const isUrl = /^https?:\/\//i.test(where.trim());
  const known = useMemo(() => new Set(files.data?.files ?? []), [files.data]);
  const path = where.trim().replace(/^\/+/, "");
  const isFile = !isUrl && known.has(path);

  // The lines the proof points at, so what is being claimed is visible here.
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (!isFile) return;
    let live = true;
    api
      .repoText(path)
      .then((r) => live && setText(r.content))
      .catch(() => live && setText(null));
    return () => {
      live = false;
    };
  }, [isFile, path]);
  const lines = text?.split("\n") ?? [];
  const a = Number(from) || 0;
  const b = Number(to) || a;
  const excerpt = a > 0 && lines.length ? lines.slice(a - 1, Math.max(a, b)).join("\n") : "";

  const addFiles = async (list: FileList | File[]) => {
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setReading(true);
    try {
      for (const file of images.slice(0, 5 - shots.length)) {
        const prepared = await prepareImage(file);
        setShots((prev) => [...prev, { ...prepared, alt: "" }]);
      }
    } catch (error) {
      toast.push({ kind: "error", message: "Could not add the picture", detail: (error as Error).message });
    } finally {
      setReading(false);
    }
  };

  const submit = () => {
    const proofs: Proof[] = [];
    if (isUrl) proofs.push({ kind: "link", url: where.trim(), label: where.trim().replace(/^https?:\/\//, "").replace(/\/$/, "") });
    else if (path) proofs.push({ kind: "place", path, from: a || null, to: b || null });
    if (quote.trim()) proofs.push({ kind: "quote", text: quote.trim() });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const base = `${slug(docPath.split("/").pop()?.replace(/\.md$/i, "") ?? "doc")}-${slug(item.title)}-${stamp}`;
    const attachments: ProofAttachment[] = shots.map((shot, index) => {
      const file = `${EVIDENCE_DIR}/${base}${shots.length > 1 ? `-${index + 1}` : ""}.${shot.ext}`;
      proofs.push({ kind: "image", path: relativePath(docPath, file), alt: shot.alt.trim() || item.title });
      return { path: file, base64: shot.base64, url: shot.url };
    });
    onDone({
      edit: {
        type: "proof",
        line: item.line,
        title: item.text,
        id: item.id,
        state,
        proofs,
        by: viewer ?? "me",
        date: new Date().toISOString().slice(0, 10),
      },
      attachments,
    });
  };

  const hasProof = Boolean(path || quote.trim() || shots.length);

  return (
    <Modal
      title="Mark as done"
      description={item.title}
      onClose={onClose}
      footer={
        <>
          <span className="text-xs text-faint">{hasProof ? "Written under the item, with your name and today's date" : "No proof: only the state changes"}</span>
          <div className="flex-1" />
          <button className="rb-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="rb-btn-primary" onClick={submit} disabled={reading || (Boolean(path) && !isUrl && !isFile)}>
            {reading ? <Spinner /> : <CheckCheck className="size-3.5" />} Mark as done
          </button>
        </>
      }
    >
      <div
        className="flex flex-col gap-5"
        onPaste={(event) => {
          const pasted = Array.from(event.clipboardData.files);
          if (pasted.some((f) => f.type.startsWith("image/"))) {
            event.preventDefault();
            void addFiles(pasted);
          }
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted" htmlFor="proof-where">
            {isUrl ? <Link2 className="size-3.5" /> : <FileText className="size-3.5" />} Where it is written
          </label>
          <div className="flex gap-2">
            <input
              id="proof-where"
              className="rb-input h-9 min-w-0 flex-1 font-mono text-xs"
              placeholder="docs/privacy-policy.md, or a link"
              value={where}
              onChange={(event) => setWhere(event.target.value)}
              list="proof-files"
              autoFocus
            />
            {!isUrl && (
              <>
                <input
                  className="rb-input h-9 w-16 text-center tabular-nums"
                  placeholder="line"
                  inputMode="numeric"
                  aria-label="From line"
                  value={from}
                  onChange={(event) => setFrom(event.target.value.replace(/\D/g, ""))}
                />
                <input
                  className="rb-input h-9 w-16 text-center tabular-nums"
                  placeholder="to"
                  inputMode="numeric"
                  aria-label="To line"
                  value={to}
                  onChange={(event) => setTo(event.target.value.replace(/\D/g, ""))}
                />
              </>
            )}
          </div>
          <datalist id="proof-files">
            {(files.data?.files ?? []).map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          {path && !isUrl && !isFile && files.data && <p className="text-xs text-danger">That file is not in the repository.</p>}
          {isFile && excerpt && (
            <div className="flex flex-col gap-1.5">
              <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-code-bg p-2.5 font-mono text-xs leading-relaxed text-ink">
                {excerpt}
              </pre>
              {!quote && (
                <button className="rb-btn-ghost w-fit" onClick={() => setQuote(excerpt)}>
                  <Quote className="size-3.5" /> Quote these lines
                </button>
              )}
            </div>
          )}
          {isFile && <p className="text-xs text-faint">Saved as a link to this exact version of the file, so it still points at these words after the file changes.</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted" htmlFor="proof-quote">
            <Quote className="size-3.5" /> The words
          </label>
          <textarea
            id="proof-quote"
            rows={3}
            className="rb-input resize-y text-sm"
            placeholder="Copy the sentence that shows it is done"
            value={quote}
            onChange={(event) => setQuote(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <ImagePlus className="size-3.5" /> Screenshot
          </span>
          <div className="flex flex-wrap gap-2">
            {shots.map((shot, index) => (
              <div key={shot.url} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.url} alt="" className="h-24 w-36 rounded-lg object-cover ring-1 ring-border" />
                <button
                  className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-surface/90 text-muted shadow-card hover:text-ink"
                  aria-label="Remove the screenshot"
                  onClick={() => setShots((prev) => prev.filter((_, i) => i !== index))}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {shots.length < 5 && (
              <button
                className="flex h-24 w-36 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
                onClick={() => input.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void addFiles(event.dataTransfer.files);
                }}
              >
                {reading ? <Spinner /> : <ImagePlus className="size-4" />}
                Paste, drop or choose
              </button>
            )}
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
