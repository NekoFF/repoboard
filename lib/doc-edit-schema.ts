import { z } from "zod";

/**
 * What a document edit may look like when it comes to the API — every
 * DocEdit type (lib/markdown/document.ts), with the limits the files keep.
 * A type missing here is refused with a 400, so a new DocEdit belongs here in
 * the same change (tests/doc-edit-schema.test.ts).
 */
export const itemState = z.enum(["todo", "doing", "review", "done", "cancelled"]);

/** Documents are markdown files; nothing else in the repository is written from here. */
export const docPath = z
  .string()
  .min(1)
  .max(500)
  .refine((p) => /\.md$/i.test(p) && !p.split("/").some((seg) => seg === ".." || seg === ".") && !/^\/|^\.github\//i.test(p), {
    message: "Only markdown documents can be written",
  });
/** A proof link goes into the file as markdown: http(s) only, nothing that could end the link. */
const proofUrl = z
  .string()
  .max(2000)
  .regex(/^https?:\/\/[^\s()<>\[\]]+$/i, "A proof link must be a plain http(s) address");
const proofImage = z
  .string()
  .max(500)
  .regex(/^(\.\.\/)*[\w./-]*evidence\/[\w.-]+\.(png|jpe?g|webp)$/i, "A screenshot must be in .repoboard/evidence/");
export const edit = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("state"),
    line: z.number().int().min(0),
    title: z.string(),
    id: z.string().nullish(),
    state: itemState,
  }),
  z.object({
    type: z.literal("toggle"),
    line: z.number().int().min(0),
    title: z.string(),
    id: z.string().nullish(),
    done: z.boolean(),
  }),
  z.object({
    type: z.literal("add"),
    section: z.string().nullable(),
    title: z.string().min(1).max(2000),
    details: z.array(z.string().max(2000)).max(20).optional(),
    cards: z.array(z.number().int().positive()).max(20).optional(),
  }),
  // The card doing an item's work (Make a card): RB-n written on its line.
  z.object({ type: z.literal("card"), line: z.number().int().min(0), title: z.string(), id: z.string().nullish(), card: z.number().int().positive() }),
  z.object({
    type: z.literal("note"),
    line: z.number().int().min(0),
    title: z.string(),
    id: z.string().nullish(),
    author: z.string().min(1).max(40),
    text: z.string().min(1).max(4000),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    type: z.literal("proof"),
    line: z.number().int().min(0),
    title: z.string(),
    id: z.string().nullish(),
    state: itemState,
    by: z.string().min(1).max(40),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    checked: z.boolean().optional(),
    proofs: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("link"), url: proofUrl, label: z.string().max(300) }),
          z.object({
            kind: z.literal("place"),
            path: z.string().min(1).max(500),
            from: z.number().int().min(1).nullish(),
            to: z.number().int().min(1).nullish(),
          }),
          z.object({ kind: z.literal("quote"), text: z.string().min(1).max(4000) }),
          z.object({ kind: z.literal("image"), path: proofImage, alt: z.string().max(300) }),
        ]),
      )
      .max(10),
  }),
  z.object({ type: z.literal("replace"), content: z.string() }),
]);
